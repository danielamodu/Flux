// Transparent protocol status. Strategy telemetry is not currently exposed by
// the backend, so this section avoids presenting hardcoded uptime, fills, or yield.
import { EXPLORER_URL, STRATEGY_ADDRESS, VAULT_ADDRESS } from '@/lib/contracts';
import { truncateAddress } from '@/lib/format';

export function ProofStrip() {
  return (
    <section className="mx-auto max-w-container px-4 py-16 sm:px-8">
      <p className="eyebrow">Protocol status</p>
      <h2 className="mt-3 max-w-measure font-display text-[clamp(2rem,1.4rem+2vw,2.75rem)] leading-tight tracking-[-0.025em] text-ink-strong">
        Vault accounting comes first
      </h2>
      <p className="mt-4 max-w-measure text-[15px] leading-relaxed text-ink-subtle">
        The Kuru strategy is registered with Flux’s testnet vault. It has no allocated capital yet,
        so Flux has not completed a funded trade cycle or demonstrated strategy revenue.
      </p>

      <div className="mt-8 grid gap-5 md:grid-cols-3">
        <div className="rounded-2xl border border-hairline bg-canvas p-6">
          <p className="eyebrow">Network</p>
          <p className="mt-3 text-xl font-medium text-ink-strong">Monad testnet</p>
          <p className="mt-2 text-sm text-ink-subtle">Chain ID 10143</p>
        </div>
        <div className="rounded-2xl border border-hairline bg-canvas p-6">
          <p className="eyebrow">Venue strategies</p>
          <p className="mt-3 text-xl font-medium text-ink-strong">Kuru · awaiting first cycle</p>
          <p className="mt-2 text-sm text-ink-subtle">No funds allocated. The contract includes oracle-bounded orders and an unwind path.</p>
          <a
            href={`${EXPLORER_URL}/address/${STRATEGY_ADDRESS}`}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-block font-mono text-sm text-primary hover:underline"
          >
            Strategy contract ↗
          </a>
        </div>
        <div className="rounded-2xl border border-hairline bg-canvas p-6">
          <p className="eyebrow">Vault contract</p>
          <a
            href={`${EXPLORER_URL}/address/${VAULT_ADDRESS}`}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-block font-mono text-xl text-ink-strong hover:text-primary"
          >
            {truncateAddress(VAULT_ADDRESS)} ↗
          </a>
          <p className="mt-2 text-sm text-ink-subtle">Empty testnet deployment. No earnings are reported.</p>
        </div>
      </div>
    </section>
  );
}
