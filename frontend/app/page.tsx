// Landing page. Server component that composes the client sections; each section
// owns its own data and interactivity. Order: hero → manual-vs-Flux → live stats →
// activity → footer.
import { Header } from '@/components/Header';
import { Hero } from '@/components/Hero';
import { BeforeAfter } from '@/components/BeforeAfter';
import { VaultStats } from '@/components/VaultStats';
import { ProofStrip } from '@/components/ProofStrip';
import { LiveFeed } from '@/components/LiveFeed';
import { FluxMark } from '@/components/FluxMark';
import { EXPLORER_URL, VAULT_ADDRESS } from '@/lib/contracts';
import { truncateAddress } from '@/lib/format';

function Footer() {
  return (
    <footer className="border-t border-hairline">
      <div className="mx-auto flex max-w-container flex-col gap-8 px-4 py-12 sm:px-8 md:flex-row md:items-start md:justify-between">
        <div className="max-w-xs">
          <FluxMark />
          <p className="mt-4 text-[14px] text-ink-subtle">
            Flux is a Monad testnet build. The Kuru adapter is deployed, but no trading revenue is verified and deposits remain paused.
          </p>
        </div>
        <nav className="flex gap-16" aria-label="Footer">
          <div className="flex flex-col gap-3">
            <p className="text-[14px] font-medium text-ink-strong">Vault</p>
            <a href="#vault" className="text-[14px] text-ink-subtle hover:text-ink">
              Live stats
            </a>
            <a
              href={`${EXPLORER_URL}/address/${VAULT_ADDRESS}`}
              target="_blank"
              rel="noreferrer"
              className="text-[14px] text-ink-subtle hover:text-ink"
            >
              Contract ↗
            </a>
          </div>
          <div className="flex flex-col gap-3">
            <p className="text-[14px] font-medium text-ink-strong">Network</p>
            <span className="text-[14px] text-ink-subtle">Monad testnet</span>
            <span className="text-[14px] text-ink-subtle">Chain ID 10143</span>
          </div>
        </nav>
      </div>
      <div className="border-t border-hairline">
        <div className="mx-auto flex max-w-container flex-col gap-2 px-4 py-5 text-[13px] text-ink-subtle sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span className="inline-flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
            Live on Monad testnet
          </span>
          <span className="font-mono">
            Vault {truncateAddress(VAULT_ADDRESS)}
          </span>
          <span>Testnet only. Not investment advice.</span>
        </div>
      </div>
    </footer>
  );
}

export default function Home() {
  return (
    <>
      <Header />
      <main id="main" tabIndex={-1} className="outline-none">
        <Hero />
        <BeforeAfter />
        <VaultStats />
        <ProofStrip />
        <LiveFeed />
      </main>
      <Footer />
    </>
  );
}
