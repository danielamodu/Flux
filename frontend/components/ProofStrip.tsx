// Transparent protocol status. Strategy telemetry is not currently exposed by
// the backend, so this section avoids presenting hardcoded uptime, fills, or yield.
import { EXPLORER_URL, VAULT_ADDRESS } from '@/lib/contracts';
import { truncateAddress } from '@/lib/format';

export function ProofStrip() {
  return (
    <section className="mx-auto max-w-container px-4 py-16 sm:px-8">
      <p className="eyebrow">Protocol status</p>
      <h2 className="mt-3 max-w-measure font-display text-[clamp(2rem,1.4rem+2vw,2.75rem)] leading-tight tracking-[-0.025em] text-ink-strong">
        Vault accounting comes first
      </h2>
      <p className="mt-4 max-w-measure text-[15px] leading-relaxed text-ink-subtle">
        Flux is a Monad testnet prototype. Perpl and Kuru integrations are being
        developed as separate market strategies; their balances and performance
        are not verified as part of vault NAV.
      </p>

      <div className="mt-8 grid gap-5 md:grid-cols-3">
        <div className="rounded-2xl border border-hairline bg-canvas p-6">
          <p className="eyebrow">Network</p>
          <p className="mt-3 text-xl font-medium text-ink-strong">Monad testnet</p>
          <p className="mt-2 text-sm text-ink-subtle">Chain ID 10143</p>
        </div>
        <div className="rounded-2xl border border-hairline bg-canvas p-6">
          <p className="eyebrow">Venue strategies</p>
          <p className="mt-3 text-xl font-medium text-ink-strong">Not included in NAV</p>
          <p className="mt-2 text-sm text-ink-subtle">Perpl and Kuru require independent funding, valuation, and unwind controls.</p>
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
          <p className="mt-2 text-sm text-ink-subtle">Testnet deployment; source changes require redeployment.</p>
        </div>
      </div>
    </section>
  );
}
