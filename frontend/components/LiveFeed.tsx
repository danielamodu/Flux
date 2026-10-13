'use client';
// Recent activity — the last five deposits and withdrawals from the shared feed
// (backfilled once, then live via event subscription). Row: direction, address,
// amount, relative time. Relative time is gated behind mount so server and client
// first paint match. Designed empty and loading states, not a blank box.
import { EXPLORER_URL } from '@/lib/contracts';
import { formatShares, formatUsd, timeAgo, truncateAddress } from '@/lib/format';
import { useVaultData, type VaultActivity } from '@/lib/vault-data';
import { useMounted } from '@/lib/useMounted';

function Row({ e, mounted }: { e: VaultActivity; mounted: boolean }) {
  const isDeposit = e.kind === 'deposit';
  return (
    <li className="flex items-center gap-3 px-5 py-3.5">
      <span
        className={`inline-flex h-6 shrink-0 items-center gap-1.5 rounded-sm px-2 text-[12px] font-medium ${
          isDeposit ? 'bg-success-fill text-on-success' : 'bg-danger-fill text-on-danger'
        }`}
      >
        {isDeposit ? '↓ Deposit' : '↑ Withdraw'}
      </span>
      <a
        href={`${EXPLORER_URL}/address/${e.user}`}
        target="_blank"
        rel="noreferrer"
        className="font-mono text-[13px] text-ink hover:text-primary"
      >
        {truncateAddress(e.user)}
      </a>
      <span className="tnum ml-auto font-medium text-ink-strong">{formatUsd(e.usdc)}</span>
      <span className="hidden w-28 text-right text-[13px] text-ink-subtle sm:inline tnum">
        {formatShares(e.shares)} LP
      </span>
      <span className="w-16 shrink-0 text-right text-[13px] text-ink-subtle tnum">
        {mounted && e.ts !== null ? timeAgo(e.ts) : '—'}
      </span>
    </li>
  );
}

export function LiveFeed() {
  const mounted = useMounted();
  const { events, eventsLoading } = useVaultData();
  const rows = events.slice(0, 5);

  return (
    <section className="mx-auto max-w-container px-4 pb-20 sm:px-8">
      <p className="eyebrow">Activity</p>
      <h2 className="mt-3 font-display text-[clamp(2rem,1.4rem+2vw,2.75rem)] leading-tight tracking-[-0.025em] text-ink-strong">
        Recent deposits &amp; withdrawals
      </h2>

      <div className="mt-8 overflow-hidden rounded-2xl border border-hairline bg-canvas">
        {eventsLoading && rows.length === 0 ? (
          <ul className="divide-y divide-hairline">
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i} className="flex items-center gap-3 px-5 py-3.5">
                <span className="skeleton h-6 w-24" />
                <span className="skeleton h-4 w-28" />
                <span className="skeleton ml-auto h-4 w-20" />
              </li>
            ))}
          </ul>
        ) : rows.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <p className="text-[16px] font-medium text-ink-strong">No activity yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-ink-subtle">
              Deposits and withdrawals will appear here as they’re confirmed on Monad.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {rows.map((e) => (
              <Row key={e.id} e={e} mounted={mounted} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
