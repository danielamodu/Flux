'use client';
// Withdraw flow. Single step — burn FLUX-LP shares for USDC at the live NAV
// (shares × totalAssets ÷ totalSupply). No approval needed to redeem your own
// shares. The share balance comes from the position card so "Max" is exact.
import { useEffect, useMemo, useState } from 'react';
import { formatUnits, parseUnits } from 'viem';
import { useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { SHARE_DECIMALS, VAULT_ABI, VAULT_ADDRESS } from '@/lib/contracts';
import { formatShares, formatUsd } from '@/lib/format';
import { useVaultData } from '@/lib/vault-data';
import { Modal } from './ui/Modal';
import { AmountField, TxStatus } from './ui/tx';

function parseShares(input: string): bigint | null {
  if (!input.trim()) return null;
  try {
    const v = parseUnits(input as `${number}`, SHARE_DECIMALS);
    return v > 0n ? v : null;
  } catch {
    return null;
  }
}

export function WithdrawModal({
  open,
  onClose,
  shares,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  shares: bigint | undefined;
  onSuccess: () => void;
}) {
  const { totalAssets, totalSupply } = useVaultData();
  const [amount, setAmount] = useState('');
  const sharesRaw = useMemo(() => parseShares(amount), [amount]);
  const overBalance = sharesRaw !== null && shares !== undefined && sharesRaw > shares;

  const usdcOut = useMemo(() => {
    if (sharesRaw === null || !totalSupply || totalSupply === 0n || !totalAssets)
      return undefined;
    return (sharesRaw * totalAssets) / totalSupply;
  }, [sharesRaw, totalSupply, totalAssets]);

  const withdraw = useWriteContract();
  const rcpt = useWaitForTransactionReceipt({ hash: withdraw.data });

  useEffect(() => {
    if (!rcpt.isSuccess) return;
    onSuccess();
    setAmount('');
  }, [rcpt.isSuccess, onSuccess]);

  useEffect(() => {
    if (!open) setAmount('');
  }, [open]);

  const busy = withdraw.isPending || rcpt.isLoading;

  const submit = () => {
    if (sharesRaw === null || overBalance) return;
    withdraw.writeContract({
      address: VAULT_ADDRESS,
      abi: VAULT_ABI,
      functionName: 'withdraw',
      args: [sharesRaw],
    });
  };

  const label = (() => {
    if (sharesRaw === null) return 'Enter an amount';
    if (overBalance) return 'Amount exceeds your balance';
    if (withdraw.isPending) return 'Confirm in your wallet…';
    if (rcpt.isLoading) return 'Withdrawing…';
    return 'Withdraw';
  })();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Withdraw"
      description="Redeem FLUX-LP shares for USDC at the current net asset value."
    >
      <AmountField
        label="Shares"
        token="FLUX-LP"
        value={amount}
        onChange={setAmount}
        disabled={busy}
        balance={shares !== undefined ? formatShares(shares) : undefined}
        onMax={
          shares !== undefined && shares > 0n
            ? () => setAmount(formatUnits(shares, SHARE_DECIMALS))
            : undefined
        }
      />

      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-ink-subtle">You receive</dt>
          <dd className="tnum font-medium text-ink-strong">
            {usdcOut !== undefined ? formatUsd(usdcOut) : '—'}
          </dd>
        </div>
      </dl>

      <button
        type="button"
        className="btn btn-primary mt-5 w-full"
        onClick={submit}
        disabled={sharesRaw === null || overBalance || busy}
        aria-busy={busy}
      >
        {label}
      </button>

      <TxStatus
        hash={withdraw.data}
        confirming={busy && !!withdraw.data}
        success={rcpt.isSuccess}
        successText="Withdrawal confirmed. USDC is on its way to your wallet."
        error={withdraw.error}
      />
    </Modal>
  );
}


