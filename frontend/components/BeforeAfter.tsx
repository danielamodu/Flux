'use client';
// The pitch, shown not told: the operational tangle of running market making
// yourself vs. depositing into Flux. Two tiles that vary one property (the right
// one carries the accent and a ring) so the grid reads as a contrast, per
// design.md bento rules — not two identical cards.
const MANUAL = [
  'Run a quoting bot 24/7 across every venue',
  'Manage inventory, skew and adverse selection',
  'Rebalance, chase rebates, avoid getting picked off',
  'Babysit RPCs, nonces, gas and downtime',
];

const FLUX = [
  { n: '1', t: 'Vault custody', d: 'Flux contracts control the pooled capital and issue transferable FLUX-LP shares.' },
  { n: '2', t: 'Trade on venues', d: 'The Kuru adapter is deployed; its first funded trading cycle is still to be proven.' },
  { n: '3', t: 'Track real performance', d: 'Report fills, fees, PnL, and risk after a full trade and unwind cycle.' },
];

export function BeforeAfter() {
  return (
    <section className="mx-auto max-w-container px-4 py-16 sm:px-8">
      <p className="eyebrow">Manual vs. Flux</p>
      <h2 className="mt-3 max-w-measure font-display text-[clamp(2rem,1.4rem+2vw,2.75rem)] leading-tight tracking-[-0.025em] text-ink-strong">
        Liquidity provision without the night shifts
      </h2>

      <div className="mt-10 grid gap-5 lg:grid-cols-2">
        {/* Before — the tangle. Muted surface, denser. */}
        <div className="rounded-2xl bg-surface-2 p-7">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 items-center rounded-sm bg-canvas px-2 text-[12px] font-medium text-ink-subtle shadow-ring">
              Manual market making
            </span>
          </div>
          <ul className="mt-6 space-y-3.5">
            {MANUAL.map((item) => (
              <li key={item} className="flex items-start gap-3 text-[15px] text-ink">
                <span
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-control-border"
                  aria-hidden="true"
                />
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-6 text-[13px] text-ink-subtle">
            Constant attention. Real operational risk.
          </p>
        </div>

        {/* After — Flux. Canvas + accent ring, numbered steps. */}
        <div className="rounded-2xl bg-canvas p-7 shadow-md ring-1 ring-primary/15">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 items-center rounded-sm bg-primary px-2 text-[12px] font-medium text-on-primary">
              Flux: custody first
            </span>
          </div>
          <ol className="mt-6 space-y-5">
            {FLUX.map((step) => (
              <li key={step.n} className="flex items-start gap-4">
                <span className="tnum flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[14px] font-medium text-ink-strong">
                  {step.n}
                </span>
                <div>
                  <p className="text-[15px] font-medium text-ink-strong">{step.t}</p>
                  <p className="mt-0.5 text-[14px] text-ink-subtle">{step.d}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-[13px] text-ink-subtle">
        Testnet prototype · deposits remain paused until the Kuru cycle is verified.
          </p>
        </div>
      </div>
    </section>
  );
}
