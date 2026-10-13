'use client';
// Single source of truth for live vault data. Polls totalAssets/totalSupply every
// 10s and fetches + watches
// Deposited/Withdrawn events once. Views read this via useVaultData() so the whole
// page shares one set of RPC calls and one consistent snapshot.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePublicClient, useReadContracts, useWatchContractEvent } from 'wagmi';
import { VAULT_ABI, VAULT_ADDRESS } from './contracts';
import { navPerShare } from './format';

export type VaultActivity = {
  id: string; // `${blockNumber}-${logIndex}` dedupe key
  kind: 'deposit' | 'withdraw';
  user: `0x${string}`;
  usdc: bigint; // USDC base units moved
  shares: bigint; // FLUX-LP shares moved
  blockNumber: bigint;
  logIndex: number;
  txHash: `0x${string}`;
  ts: number | null; // ms; null until the block timestamp resolves
};

type VaultContextValue = {
  totalAssets?: bigint;
  totalSupply?: bigint;
  nav?: number;
  totalsLoading: boolean;
  events: VaultActivity[];
  eventsLoading: boolean;
  refetchTotals: () => void;
};

const VaultContext = createContext<VaultContextValue | null>(null);

const POLL_MS = 10_000;
const CHUNK = 100n; // Monad's public RPC caps eth_getLogs range — stay small
const MAX_CHUNKS = 20; // scan back up to ~2000 blocks for history
const TARGET_EVENTS = 8; // enough history to populate the recent activity feed

const keyOf = (blockNumber: bigint, logIndex: number) =>
  `${blockNumber.toString()}-${logIndex}`;

// Runtime-validated decode. getContractEvents (no eventName) returns a union of
// Deposited/Withdrawn logs; we narrow on eventName and guard every field.
function toActivity(log: any): VaultActivity | null {
  const blockNumber = log?.blockNumber as bigint | null;
  const logIndex = log?.logIndex as number | null;
  const txHash = log?.transactionHash as `0x${string}` | null;
  if (blockNumber == null || logIndex == null || !txHash) return null;
  const args = log.args ?? {};
  if (log.eventName === 'Deposited') {
    if (!args.user || args.usdcAmount === undefined || args.sharesIssued === undefined)
      return null;
    return {
      id: keyOf(blockNumber, logIndex),
      kind: 'deposit',
      user: args.user,
      usdc: args.usdcAmount,
      shares: args.sharesIssued,
      blockNumber,
      logIndex,
      txHash,
      ts: null,
    };
  }
  if (log.eventName === 'Withdrawn') {
    if (!args.user || args.sharesRedeemed === undefined || args.usdcAmount === undefined)
      return null;
    return {
      id: keyOf(blockNumber, logIndex),
      kind: 'withdraw',
      user: args.user,
      usdc: args.usdcAmount,
      shares: args.sharesRedeemed,
      blockNumber,
      logIndex,
      txHash,
      ts: null,
    };
  }
  return null;
}
export function VaultDataProvider({ children }: { children: ReactNode }) {
  const publicClient = usePublicClient();

  const {
    data,
    refetch,
    isLoading: totalsLoading,
  } = useReadContracts({
    contracts: [
      { address: VAULT_ADDRESS, abi: VAULT_ABI, functionName: 'totalAssets' },
      { address: VAULT_ADDRESS, abi: VAULT_ABI, functionName: 'totalSupply' },
    ],
    query: { refetchInterval: POLL_MS },
  });

  const totalAssets = data?.[0]?.result as bigint | undefined;
  const totalSupply = data?.[1]?.result as bigint | undefined;
  const nav = navPerShare(totalAssets, totalSupply);

  const [events, setEvents] = useState<VaultActivity[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const tsCacheRef = useRef<Map<string, number>>(new Map()); // blockNumber -> ms
  const resolveTimestamps = useCallback(
    async (items: VaultActivity[]): Promise<VaultActivity[]> => {
      if (!publicClient) return items;
      const cache = tsCacheRef.current;
      const needed = Array.from(
        new Set(items.filter((e) => e.ts === null).map((e) => e.blockNumber.toString())),
      ).slice(0, 12);
      await Promise.all(
        needed.map(async (bn) => {
          if (cache.has(bn)) return;
          try {
            const block = await publicClient.getBlock({ blockNumber: BigInt(bn) });
            cache.set(bn, Number(block.timestamp) * 1000);
          } catch {
            /* leave unresolved; the row shows a neutral placeholder */
          }
        }),
      );
      return items.map((e) =>
        e.ts === null && cache.has(e.blockNumber.toString())
          ? { ...e, ts: cache.get(e.blockNumber.toString())! }
          : e,
      );
    },
    [publicClient],
  );

  const merge = useCallback((incoming: VaultActivity[]) => {
    setEvents((prev) => {
      const map = new Map(prev.map((e) => [e.id, e]));
      for (const e of incoming) {
        const existing = map.get(e.id);
        map.set(e.id, existing && e.ts === null ? { ...e, ts: existing.ts } : e);
      }
      return Array.from(map.values()).sort((a, b) =>
        a.blockNumber !== b.blockNumber
          ? a.blockNumber > b.blockNumber
            ? -1
            : 1
          : b.logIndex - a.logIndex,
      );
    });
  }, []);
  // One-shot backward scan for recent history, in RPC-safe chunks.
  useEffect(() => {
    if (!publicClient) return;
    let cancelled = false;
    (async () => {
      setEventsLoading(true);
      try {
        const latest = await publicClient.getBlockNumber();
        const collected: VaultActivity[] = [];
        let to = latest;
        for (let i = 0; i < MAX_CHUNKS && collected.length < TARGET_EVENTS; i++) {
          const from = to > CHUNK ? to - CHUNK + 1n : 0n;
          let logs: unknown[];
          try {
            logs = await publicClient.getContractEvents({
              address: VAULT_ADDRESS,
              abi: VAULT_ABI,
              fromBlock: from,
              toBlock: to,
            });
          } catch {
            break; // range rejected / rate-limited: keep what we have
          }
          for (const log of logs) {
            const parsed = toActivity(log);
            if (parsed) collected.push(parsed);
          }
          if (from === 0n) break;
          to = from - 1n;
        }
        const withTs = await resolveTimestamps(collected);
        if (!cancelled) merge(withTs);
      } catch {
        /* leave the feed empty; the live subscription still fills it */
      } finally {
        if (!cancelled) setEventsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicClient, resolveTimestamps, merge]);

  const onLogs = useCallback(
    (logs: readonly unknown[]) => {
      const parsed = logs.map(toActivity).filter((e): e is VaultActivity => e !== null);
      if (parsed.length === 0) return;
      void resolveTimestamps(parsed).then((withTs) => {
        merge(withTs);
        refetch();
      });
    },
    [resolveTimestamps, merge, refetch],
  );

  useWatchContractEvent({ address: VAULT_ADDRESS, abi: VAULT_ABI, eventName: 'Deposited', onLogs });
  useWatchContractEvent({ address: VAULT_ADDRESS, abi: VAULT_ABI, eventName: 'Withdrawn', onLogs });
  const value: VaultContextValue = {
    totalAssets,
    totalSupply,
    nav,
    totalsLoading,
    events,
    eventsLoading,
    refetchTotals: refetch,
  };

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export function useVaultData(): VaultContextValue {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error('useVaultData must be used within VaultDataProvider');
  return ctx;
}
