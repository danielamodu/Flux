'use client';
// Deposit flow. Two on-chain steps when needed: approve USDC to the vault, then
// deposit. Shares previewed at the live rate (amount × totalSupply ÷ totalAssets,
// or 1:1 at genesis). The button reflects exactly where the flow is — confirm in
// wallet, mining, or ready — and errors say what to do next.
import { useEffect, useMemo, useState } from 'react';
import { formatUnits, parseUnits } from 'viem';
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi';
import {
  ERC20_ABI,
  EXPLORER_URL,
  USDC_ADDRESS,
  USDC_DECIMALS,
  VAULT_ABI,
  VAULT_ADDRESS,
  DEPOSITS_ENABLED,
} from '@/lib/contracts';
import { formatShares, formatUsd } from '@/lib/format';
import { useVaultData } from '@/lib/vault-data';
import { Modal } from './ui/Modal';
import { TxStatus, AmountField } from './ui/tx';

function parseAmount(input: string): bigint | null {
  if (!input.trim()) return null;
  try {
    const v = parseUnits(input as `${number}`, USDC_DECIMALS);
    return v > 0n ? v : null;
  } catch {
    return null;
  }
}

export function DepositModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { address } = useAccount();
  const { totalAssets, totalSupply } = useVaultData();
  const [amount, setAmount] = useState('');
  const { data: usdcBalance, refetch: refetchBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, VAULT_ADDRESS] : undefined,
    query: { enabled: !!address },
  });

  const amountRaw = useMemo(() => parseAmount(amount), [amount]);
  const overBalance =
    amountRaw !== null && usdcBalance !== undefined && amountRaw > usdcBalance;
  const needsApproval =
    amountRaw !== null && (allowance === undefined || allowance < amountRaw);

  const sharesOut = useMemo(() => {
    if (amountRaw === null) return undefined;
    if (!totalSupply || totalSupply === 0n || !totalAssets) return amountRaw; // 1:1 genesis
    return (amountRaw * totalSupply) / totalAssets;
  }, [amountRaw, totalSupply, totalAssets]);

  const approve = useWriteContract();
  const deposit = useWriteContract();
  const approveRcpt = useWaitForTransactionReceipt({ hash: approve.data });
  const depositRcpt = useWaitForTransactionReceipt({ hash: deposit.data });
  useEffect(() => {
    if (approveRcpt.isSuccess) refetchAllowance();
  }, [approveRcpt.isSuccess, refetchAllowance]);

  useEffect(() => {
    if (!depositRcpt.isSuccess) return;
    onSuccess();
    refetchBalance();
    refetchAllowance();
    setAmount('');
  }, [depositRcpt.isSuccess, onSuccess, refetchBalance, refetchAllowance]);

  useEffect(() => {
    if (!open) setAmount('');
  }, [open]);

  const busy =
    approve.isPending ||
    approveRcpt.isLoading ||
    deposit.isPending ||
    depositRcpt.isLoading;

  const submit = () => {
    if (!DEPOSITS_ENABLED) return;
    if (amountRaw === null || overBalance) return;
    if (needsApproval) {
      approve.writeContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [VAULT_ADDRESS, amountRaw],
      });
    } else {
      deposit.writeContract({
        address: VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: 'deposit',
        args: [amountRaw],
      });
    }
  };

  const label = (() => {
    if (amountRaw === null) return 'Enter an amount';
    if (overBalance) return 'Insufficient USDC balance';
    if (approve.isPending || deposit.isPending) return 'Confirm in your wallet…';
    if (approveRcpt.isLoading) return 'Approving…';
    if (depositRcpt.isLoading) return 'Depositing…';
    return needsApproval ? 'Approve USDC' : 'Deposit';
  })();

  const error = approve.error ?? deposit.error;
  const activeHash = deposit.data ?? approve.data;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Deposit USDC"
      description="Mint FLUX-LP shares at the current net asset value."
    >
      <AmountField
        label="Amount"
        token="USDC"
        value={amount}
        onChange={setAmount}
        disabled={busy}
        balance={usdcBalance !== undefined ? formatUsd(usdcBalance) : undefined}
        onMax={
          usdcBalance !== undefined && usdcBalance > 0n
            ? () => setAmount(formatUnits(usdcBalance, USDC_DECIMALS))
            : undefined
        }
      />

      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-ink-subtle">You receive</dt>
          <dd className="tnum font-medium text-ink-strong">
            {sharesOut !== undefined ? `${formatShares(sharesOut)} FLUX-LP` : '—'}
          </dd>
        </div>
        {needsApproval && amountRaw !== null && !overBalance && (
          <div className="flex items-center justify-between text-ink-subtle">
            <dt>Steps</dt>
            <dd>1 · Approve → 2 · Deposit</dd>
          </div>
        )}
      </dl>

      <button
        type="button"
        className="btn btn-primary mt-5 w-full"
        onClick={submit}
        disabled={!DEPOSITS_ENABLED || amountRaw === null || overBalance || busy}
        aria-busy={busy}
      >
        {DEPOSITS_ENABLED ? label : 'Deposits paused for this legacy vault'}
      </button>

      {!DEPOSITS_ENABLED && (
        <p className="mt-3 text-sm text-ink-subtle">
          This app points to the legacy contract. The custody-based vault source has not yet been redeployed.
        </p>
      )}

      <TxStatus
        hash={activeHash}
        confirming={busy && !!activeHash}
        success={depositRcpt.isSuccess}
        successText="Deposit confirmed. Your FLUX-LP balance is updating."
        error={error}
      />
    </Modal>
  );
}



