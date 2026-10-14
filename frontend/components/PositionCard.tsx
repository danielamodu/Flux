'use client';
// The connected user's stake: FLUX-LP share balance and its USDC value at the
// current NAV (shares × totalAssets ÷ totalSupply, all in base units). Owns the
// deposit/withdraw modal state and refetches balances when a tx confirms.
import { useState } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { DEPOSITS_ENABLED, DEPOSITS_PAUSE_REASON, VAULT_ABI, VAULT_ADDRESS } from '@/lib/contracts';
import { formatShares, formatUsd } from '@/lib/format';
import { useVaultData } from '@/lib/vault-data';
import { useMounted } from '@/lib/useMounted';
import { DepositModal } from './DepositModal';
import { IntentsDeposit } from './IntentsDeposit';
import { WithdrawModal } from './WithdrawModal';

export function PositionCard() {
  const mounted = useMounted();
  const { address } = useAccount();
  const { totalAssets, totalSupply, refetchTotals } = useVaultData();
  const [open, setOpen] = useState<null | 'deposit' | 'withdraw' | 'intents'>(null);

  const { data: shares, refetch: refetchShares } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 10_000 },
  });

  const positionValue =
    shares !== undefined && totalAssets !== undefined && totalSupply && totalSupply > 0n
      ? (shares * totalAssets) / totalSupply
      : shares !== undefined
        ? 0n
        : undefined;

  const hasStake = (shares ?? 0n) > 0n;
  const refresh = () => {
    refetchShares();
    refetchTotals();
  };

  return (
    <div className="card p-6">
      <span className="eyebrow">Your position</span>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <p className="text-[13px] text-ink-subtle">Value</p>
          <p className="tnum mt-1 text-[28px] font-medium leading-none tracking-[-0.02em] text-ink-strong">
            {mounted ? formatUsd(positionValue) : <span className="skeleton inline-block h-7 w-24" />}
          </p>
        </div>
        <div>
          <p className="text-[13px] text-ink-subtle">FLUX-LP</p>
          <p className="tnum mt-1 text-[28px] font-medium leading-none tracking-[-0.02em] text-ink-strong">
            {mounted ? formatShares(shares) : <span className="skeleton inline-block h-7 w-20" />}
          </p>
        </div>
      </div>

      <div className="mt-6 flex gap-3">
        <button type="button" className="btn btn-primary flex-1" onClick={() => setOpen('deposit')} disabled={!DEPOSITS_ENABLED}>
          {DEPOSITS_ENABLED ? 'Deposit' : 'Deposits paused'}
        </button>
        <button
          type="button"
          className="btn btn-secondary flex-1"
          onClick={() => setOpen('withdraw')}
          disabled={mounted && !hasStake}
        >
          Withdraw
        </button>
      </div>
      {mounted && !hasStake && (
        <p className="mt-3 text-[13px] text-ink-subtle">
          {DEPOSITS_ENABLED
            ? 'This cash-only testnet vault does not include venue strategy positions.'
            : DEPOSITS_PAUSE_REASON}
        </p>
      )}
      <button
        type="button"
        className="btn btn-secondary mt-3 w-full"
        onClick={() => setOpen('intents')}
        disabled={!address}
      >
        Deposit from any chain ↗
      </button>

      <DepositModal
        open={open === 'deposit'}
        onClose={() => setOpen(null)}
        onSuccess={refresh}
      />
      <IntentsDeposit open={open === 'intents'} onClose={() => setOpen(null)} />
      <WithdrawModal
        open={open === 'withdraw'}
        onClose={() => setOpen(null)}
        shares={shares}
        onSuccess={refresh}
      />
    </div>
  );
}
