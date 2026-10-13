'use client';
// Hero. Before connect: the primary CTA. After connect: the position card takes
// the right rail. Yield metrics stay out until backed by durable performance data.
import { useAccount } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { formatUsd } from '@/lib/format';
import { useVaultData } from '@/lib/vault-data';
import { PositionCard } from './PositionCard';

function VaultSnapshot() {
  const { totalAssets, nav, totalsLoading } = useVaultData();
  return (
    <div className="card p-6">
      <div className="flex items-center justify-between">
        <span className="eyebrow">Legacy contract snapshot</span>
        <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-subtle">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
          </span>
          Monad testnet
        </span>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-4">
        <div>
          <dt className="text-sm text-ink-subtle">Contract-reported assets</dt>
          <dd className="tnum mt-1 text-2xl font-medium text-ink-strong">
            {totalsLoading && totalAssets === undefined ? 'Loading…' : formatUsd(totalAssets)}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-ink-subtle">NAV / share</dt>
          <dd className="tnum mt-1 text-2xl font-medium text-ink-strong">
            {nav === undefined ? '—' : `$${nav.toFixed(4)}`}
          </dd>
        </div>
      </dl>
      <p className="mt-4 text-sm text-ink-subtle">This legacy contract’s NAV is owner-settable; verify its USDC balance before relying on the figures.</p>
    </div>
  );
}

export function Hero() {
  const { isConnected } = useAccount();
  return (
    <section className="mx-auto max-w-container px-4 pb-16 pt-14 sm:px-8 sm:pt-20">
      <div className="reveal grid items-start gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
        <div>
          <p className="eyebrow">Autonomous market making · Monad testnet</p>
          <h1 className="mt-4 font-display text-[clamp(2.75rem,1.6rem+3.8vw,4.5rem)] leading-[1.02] tracking-[-0.03em] text-ink-strong">
            The passive liquidity layer for Monad
          </h1>
          <p className="mt-5 max-w-measure text-lg leading-relaxed text-ink">
            A Monad vault prototype with transparent, on-chain share accounting.
            The custody-based vault is live, with share accounting backed by USDC held on-chain.
          </p>
          {!isConnected && (
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <ConnectButton.Custom>
                {({ openConnectModal, mounted }) => (
                  <button
                    type="button"
                    onClick={openConnectModal}
                    disabled={!mounted}
                    className="btn btn-cta"
                  >
                    Connect wallet
                  </button>
                )}
              </ConnectButton.Custom>
              <a href="#vault" className="btn btn-secondary">
                See the vault
              </a>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <VaultSnapshot />
          {isConnected && <PositionCard />}
        </div>
      </div>
    </section>
  );
}
