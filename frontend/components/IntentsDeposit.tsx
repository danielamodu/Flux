'use client';
// Any-chain deposit via Aurora/NEAR Intents (1Click Swap API).
// Flow: pick origin asset + amount → dry preview → live quote (deposit
// address) → user funds it from the origin chain → we poll status → SUCCESS
// means USDC landed on Monad at the recipient address.
//
// Honest boundary: Intents currently delivers to Monad mainnet, while Flux's
// vault lives on Monad testnet. The modal says so; testnet delivery is a
// config change once Intents lists the testnet asset.
import { useEffect, useMemo, useState } from 'react';
import { parseUnits } from 'viem';
import { useAccount } from 'wagmi';
import { Modal } from './ui/Modal';
import {
  INTENTS_DESTINATION_ASSET,
  INTENTS_ORIGIN_ASSETS,
  pollIntentsStatus,
  previewIntentsSwap,
  requestIntentsSwap,
  type IntentsStatus,
} from '@/lib/intents';
import { truncateAddress } from '@/lib/format';

type Step = 'form' | 'quoted' | 'tracking' | 'done';

function copyText(text: string): void {
  if (navigator.clipboard) void navigator.clipboard.writeText(text);
}

const STEP_LABEL: Record<IntentsStatus, string> = {
  PENDING_DEPOSIT: 'Waiting for your deposit…',
  KNOWN_DEPOSIT_TX: 'Deposit seen, confirming…',
  INCOMPLETE_DEPOSIT: 'Deposit below the quoted amount — top up or wait for the refund.',
  PROCESSING: 'Swapping to USDC on Monad…',
  SUCCESS: 'USDC delivered.',
  REFUNDED: 'Deposit was refunded. Check the refund address.',
  FAILED: 'Swap failed. Contact support with the deposit address.',
};

export function IntentsDeposit({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { address } = useAccount();
  const [assetId, setAssetId] = useState(INTENTS_ORIGIN_ASSETS[0].id);
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [step, setStep] = useState<Step>('form');
  const [preview, setPreview] = useState<string | null>(null);
  const [depositAddress, setDepositAddress] = useState('');
  const [depositMemo, setDepositMemo] = useState<string | undefined>();
  const [expectedOut, setExpectedOut] = useState('');
  const [status, setStatus] = useState<IntentsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const asset = useMemo(
    () => INTENTS_ORIGIN_ASSETS.find((a) => a.id === assetId) ?? INTENTS_ORIGIN_ASSETS[0],
    [assetId],
  );

  useEffect(() => {
    if (open) {
      setAmount('');
      setRecipient(address ?? '');
      setStep('form');
      setPreview(null);
      setDepositAddress('');
      setDepositMemo(undefined);
      setExpectedOut('');
      setStatus(null);
      setError(null);
    }
  }, [open, address]);

  useEffect(() => {
    if (step !== 'tracking' || !depositAddress) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await pollIntentsStatus({ depositAddress, depositMemo });
        if (cancelled) return;
        setStatus(next);
        if (next === 'SUCCESS' || next === 'REFUNDED' || next === 'FAILED') {
          setStep('done');
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Status check failed');
      }
    };
    void tick();
    const timer = setInterval(tick, 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [step, depositAddress, depositMemo]);

  const amountRaw = useMemo(() => {
    if (!amount.trim()) return null;
    try {
      const v = parseUnits(amount as `${number}`, asset.decimals);
      return v > 0n ? v.toString() : null;
    } catch {
      return null;
    }
  }, [amount, asset]);

  const runPreview = async () => {
    if (!amountRaw || !recipient) return;
    setBusy(true);
    setError(null);
    try {
      const out = await previewIntentsSwap({
        originAsset: asset.id,
        amount: amountRaw,
        recipient,
      });
      setPreview(`≈ ${out.amountOutFormatted} USDC ($${out.amountOutUsd})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setBusy(false);
    }
  };

  const runQuote = async () => {
    if (!amountRaw || !recipient) return;
    setBusy(true);
    setError(null);
    try {
      const res = await requestIntentsSwap({
        originAsset: asset.id,
        amount: amountRaw,
        recipient,
      });
      setDepositAddress(res.quote.depositAddress);
      setDepositMemo(res.quote.depositMemo);
      setExpectedOut(res.quote.amountOutFormatted);
      setStatus('PENDING_DEPOSIT');
      setStep('quoted');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Quote failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Deposit from any chain"
      description="Powered by Aurora Intents: swap any supported asset into USDC on Monad."
    >
      {step === 'form' && (
        <>
          <label className="block text-[13px] font-medium text-ink-strong" htmlFor="intents-asset">
            From
          </label>
          <select
            id="intents-asset"
            className="mt-2 w-full rounded-md border border-hairline-strong bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-primary"
            value={assetId}
            onChange={(e) => {
              setAssetId(e.target.value);
              setPreview(null);
            }}
            disabled={busy}
          >
            {INTENTS_ORIGIN_ASSETS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.symbol} · {a.chain}
              </option>
            ))}
          </select>

          <label className="mt-4 block text-[13px] font-medium text-ink-strong" htmlFor="intents-amount">
            Amount
          </label>
          <input
            id="intents-amount"
            className="tnum mt-2 w-full rounded-md border border-hairline-strong bg-canvas px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-subtle focus:border-primary"
            inputMode="decimal"
            placeholder="10.00"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setPreview(null);
            }}
            disabled={busy}
          />

          <label className="mt-4 block text-[13px] font-medium text-ink-strong" htmlFor="intents-recipient">
            Monad recipient
          </label>
          <input
            id="intents-recipient"
            className="mt-2 w-full rounded-md border border-hairline-strong bg-canvas px-3 py-2 font-mono text-[13px] text-ink outline-none placeholder:text-ink-subtle focus:border-primary"
            placeholder="0x…"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value.trim())}
            disabled={busy}
          />

          {preview && (
            <p className="tnum mt-4 text-sm font-medium text-ink-strong">{preview}</p>
          )}

          <div className="mt-5 flex gap-3">
            <button
              type="button"
              className="btn btn-secondary flex-1"
              onClick={runPreview}
              disabled={!amountRaw || !recipient || busy}
            >
              {busy ? 'Quoting…' : 'Preview rate'}
            </button>
            <button
              type="button"
              className="btn btn-primary flex-1"
              onClick={runQuote}
              disabled={!amountRaw || !recipient || busy}
            >
              Get deposit address
            </button>
          </div>
          <p className="mt-3 text-[13px] text-ink-subtle">
            Delivers {INTENTS_DESTINATION_ASSET.symbol} on Monad mainnet
            ({truncateAddress(INTENTS_DESTINATION_ASSET.contract)}). Flux&apos;s
            vault is on testnet — mainnet USDC moves over once Intents lists
            the testnet asset.
          </p>
        </>
      )}

      {(step === 'quoted' || step === 'tracking' || step === 'done') && (
        <>
          <dl className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-ink-subtle">Send exactly</dt>
              <dd className="tnum font-medium text-ink-strong">
                {amount} {asset.symbol} ({asset.chain})
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-ink-subtle">To deposit address</dt>
              <dd>
                <button
                  type="button"
                  className="font-mono text-[13px] text-link"
                  onClick={() => copyText(depositAddress)}
                  title="Copy deposit address"
                >
                  {truncateAddress(depositAddress)} ⧉
                </button>
              </dd>
            </div>
            {depositMemo && (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-subtle">Memo (required)</dt>
                <dd>
                  <button
                    type="button"
                    className="font-mono text-[13px] text-link"
                    onClick={() => copyText(depositMemo)}
                    title="Copy memo"
                  >
                    {depositMemo} ⧉
                  </button>
                </dd>
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <dt className="text-ink-subtle">You receive</dt>
              <dd className="tnum font-medium text-ink-strong">
                ≈ {expectedOut} USDC on Monad
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-ink-subtle">Status</dt>
              <dd className="font-medium text-ink-strong">
                {status ? STEP_LABEL[status] : '—'}
              </dd>
            </div>
          </dl>

          {step === 'quoted' && (
            <button
              type="button"
              className="btn btn-primary mt-5 w-full"
              onClick={() => setStep('tracking')}
            >
              I&apos;ve sent the deposit — track it
            </button>
          )}
          {step === 'done' && status === 'SUCCESS' && (
            <p className="mt-4 rounded-md bg-surface-2 p-3 text-sm text-ink">
              USDC landed at {truncateAddress(recipient)}. Once Intents
              supports Monad testnet, this button will deposit straight into
              the Flux vault.
            </p>
          )}
        </>
      )}

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </Modal>
  );
}
