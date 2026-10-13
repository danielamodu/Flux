'use client';
// Live vault KPIs — one shared poll via useVaultData, refreshed every 10s. Three
// unboxed stats separated by hairlines (design.md KPI row). Undefined values show
// a skeleton, not a zero, so the UI never asserts data it doesn't have.
import type { ReactNode } from 'react';
import { formatShares, formatUsd } from '@/lib/format';
import { useVaultData } from '@/lib/vault-data';

function StatCell({
  label,
  value,
  loading,
  hint,
}: {
  label: string;
  value: ReactNode;
  loading?: boolean;
  hint?: string;
}) {
  return (
    <div className="px-6 py-5 first:pl-0 last:pr-0">
      <p className="eyebrow">{label}</p>
      <div className="tnum mt-2 text-[32px] font-medium leading-none tracking-[-0.025em] text-ink-strong">
        {loading ? <span className="skeleton block h-8 w-28" /> : value}
      </div>
      {hint && <p className="mt-2 text-[13px] text-ink-subtle">{hint}</p>}
    </div>
  );
}

export function VaultStats() {
  const { totalAssets, totalSupply, nav, totalsLoading } = useVaultData();

  return (
    <section id="vault" className="mx-auto max-w-container scroll-mt-20 px-4 py-16 sm:px-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Live · updates every 10s</p>
          <h2 className="mt-3 font-display text-[clamp(2rem,1.4rem+2vw,2.75rem)] leading-tight tracking-[-0.025em] text-ink-strong">
            Strategy vault snapshot
          </h2>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 divide-y divide-hairline rounded-2xl border border-hairline bg-canvas sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <StatCell label="Reported assets" value={formatUsd(totalAssets)} loading={totalsLoading && totalAssets === undefined} />
        <StatCell
          label="Total shares"
          value={`${formatShares(totalSupply)} FLUX-LP`}
          loading={totalsLoading && totalSupply === undefined}
        />
        <StatCell
          label="NAV / share"
          value={nav !== undefined ? `$${nav.toFixed(4)}` : '—'}
          loading={totalsLoading && nav === undefined}
        />
      </div>
    </section>
  );
}
