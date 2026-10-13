// Formatting helpers. All on-chain amounts are bigint base units; these turn them
// into the strings the UI shows. Numeric output uses grouping + fixed decimals so
// columns line up under `font-variant-numeric: tabular-nums`.
import { formatUnits } from 'viem';
import { USDC_DECIMALS, SHARE_DECIMALS } from './contracts';

function toNumber(raw: bigint, decimals: number): number {
  return Number(formatUnits(raw, decimals));
}

/** "$1,234.56" from 6-decimal USDC base units. */
export function formatUsd(raw: bigint | undefined, fractionDigits = 2): string {
  if (raw === undefined) return '—';
  const n = toNumber(raw, USDC_DECIMALS);
  return `$${n.toLocaleString('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}`;
}

/** Plain grouped number from FLUX-LP share base units, no currency symbol. */
export function formatShares(raw: bigint | undefined, fractionDigits = 2): string {
  if (raw === undefined) return '—';
  const n = toNumber(raw, SHARE_DECIMALS);
  return n.toLocaleString('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/** NAV per share = totalAssets / totalSupply, as a float (1.0 at genesis). */
export function navPerShare(
  totalAssets: bigint | undefined,
  totalSupply: bigint | undefined,
): number | undefined {
  if (totalAssets === undefined || totalSupply === undefined) return undefined;
  if (totalSupply === 0n) return 1;
  // Both are 6-decimal, so the ratio is unitless; compute in float space.
  return toNumber(totalAssets, USDC_DECIMALS) / toNumber(totalSupply, SHARE_DECIMALS);
}

/** 0x71C7…976F — middle-truncated per the address-display convention. */
export function truncateAddress(address: string): string {
  if (!address || address.length < 11) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Compact relative time: "just now", "3m ago", "5h ago", "2d ago". */
export function timeAgo(tsMs: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - tsMs) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
