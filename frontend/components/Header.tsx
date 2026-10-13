'use client';
// Sticky glass header. Logo left, wallet right (design.md marketing nav: at most
// two controls on the right). ConnectButton.Custom lets the wallet control wear
// 71UI styling instead of RainbowKit's default. States: connect, wrong network,
// connected pill.
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { FluxMark } from './FluxMark';

export function Header() {
  return (
    <header className="glass sticky top-0 z-20">
      <div className="mx-auto flex h-16 max-w-container items-center justify-between px-4 sm:px-8">
        <a href="#main" className="flex items-center" aria-label="Flux home">
          <FluxMark />
        </a>

        <ConnectButton.Custom>
          {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
            const ready = mounted;
            const connected = ready && account && chain;
            return (
              <div
                aria-hidden={!ready}
                className={ready ? '' : 'pointer-events-none select-none opacity-0'}
              >
                {(() => {
                  if (!connected) {
                    return (
                      <button type="button" onClick={openConnectModal} className="btn btn-inverse">
                        Connect wallet
                      </button>
                    );
                  }
                  if (chain.unsupported) {
                    return (
                      <button
                        type="button"
                        onClick={openChainModal}
                        className="btn h-10 bg-danger-fill px-3 text-on-danger"
                      >
                        Wrong network
                      </button>
                    );
                  }
                  return (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={openChainModal}
                        className="btn btn-secondary hidden h-10 gap-1.5 px-3 sm:inline-flex"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
                        {chain.name}
                      </button>
                      <button
                        type="button"
                        onClick={openAccountModal}
                        className="btn btn-secondary h-10 gap-2 px-3 font-mono text-[13px]"
                      >
                        {account.displayName}
                        {account.displayBalance ? (
                          <span className="text-ink-subtle">· {account.displayBalance}</span>
                        ) : null}
                      </button>
                    </div>
                  );
                })()}
              </div>
            );
          }}
        </ConnectButton.Custom>
      </div>
    </header>
  );
}
