'use client';
// Shared bits for the deposit/withdraw flows: the amount well (design.md amount
// input) and a transaction status line that never fakes state — it shows submit,
// confirming, confirmed or a plain-language error with a retry cue.
import { EXPLORER_URL } from '@/lib/contracts';

function sanitize(input: string): string {
  const cleaned = input.replace(/[^0-9.]/g, '');
  const parts = cleaned.split('.');
  return parts.length <= 1 ? cleaned : `${parts[0]}.${parts.slice(1).join('')}`;
}

export function AmountField({
  label,
  token,
  value,
  onChange,
  balance,
  onMax,
  disabled,
}: {
  label: string;
  token: string;
  value: string;
  onChange: (v: string) => void;
  balance?: string;
  onMax?: () => void;
  disabled?: boolean;
}) {
  const inputId = `amount-${label.toLowerCase()}`;
  return (
    <div className="rounded-xl bg-surface-2 p-4">
      <div className="flex items-center justify-between">
        <label htmlFor={inputId} className="text-[13px] font-medium text-ink-subtle">
          {label}
        </label>
        <span className="rounded-full bg-canvas px-2.5 py-1 font-mono text-[12px] text-ink-strong shadow-ring">
          {token}
        </span>
      </div>
      <input
        id={inputId}
        inputMode="decimal"
        autoComplete="off"
        placeholder="0.00"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(sanitize(e.target.value))}
        className="tnum mt-2 w-full bg-transparent text-[32px] font-medium tracking-[-0.02em] text-ink-strong outline-none placeholder:text-ink-subtle disabled:opacity-60"
      />
      {(balance !== undefined || onMax) && (
        <div className="mt-1 flex items-center gap-2 text-[13px] text-ink-subtle">
          {balance !== undefined && <span className="tnum">Balance: {balance}</span>}
          {onMax && (
            <>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={onMax}
                disabled={disabled}
                className="font-medium text-link hover:text-primary-hover"
              >
                Max
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function TxStatus({
  hash,
  confirming,
  success,
  successText,
  error,
}: {
  hash?: `0x${string}`;
  confirming?: boolean;
  success?: boolean;
  successText: string;
  error?: { message?: string; shortMessage?: string } | null;
}) {
  if (!hash && !error) return null;
  const explorer = hash ? `${EXPLORER_URL}/tx/${hash}` : undefined;

  if (error) {
    const reason = error.shortMessage ?? 'The transaction was rejected or reverted.';
    return (
      <p role="alert" className="mt-4 rounded-lg bg-danger-fill px-3 py-2.5 text-[13px] text-on-danger">
        {reason} Check your wallet and try again.
      </p>
    );
  }

  return (
    <div role="status" className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-surface px-3 py-2.5 text-[13px]">
      <span className={success ? 'text-on-success' : 'text-ink-subtle'}>
        {success ? successText : confirming ? 'Confirming on Monad…' : 'Submitted'}
      </span>
      {explorer && (
        <a
          href={explorer}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-link hover:text-primary-hover"
        >
          View on explorer ↗
        </a>
      )}
    </div>
  );
}
