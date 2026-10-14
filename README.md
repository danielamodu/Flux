# Flux

**Flux is building vault-controlled market making across Monad.** The Kuru strategy is deployed to Monad testnet and a first funded cycle (deposit → allocate → quote → fill → cancel → unwind → withdraw) is verified at tiny size with ~zero PnL. No revenue is proven and app deposits remain paused.

---

## What is Flux?

Flux is a Monad testnet prototype for earning from activity on trading venues, rather than lending yield. The new `FluxStrategyVault.sol` issues transferable **FLUX-LP** shares against idle quote assets plus fresh NAV reported by registered strategies. Deposits remain paused in the frontend until Kuru allocation, trading, unwind, and withdrawal have been exercised end to end.

## The problem it solves

Automated market making adds inventory, adverse-selection, and operational risks. Flux currently has no allocated capital and has not demonstrated trading revenue. The Kuru strategy is the first deployed venue integration; all reported revenue remains zero until a full testnet cycle is reconciled.

## How it works

`FluxStrategyVault.sol` combines idle quote-token balance with fresh NAV reported by each registered adapter. It bounds strategy capital, restricts execution to an owner/keeper, and exposes pause and emergency-exit controls. `KuruMarginStrategy.sol` routes orders through a Flux-controlled Kuru MarginAccount and bounds order prices against Stork feeds. These contracts are testnet prototypes, not independently audited; their NAV and unwind behavior still need a funded end-to-end exercise.

When the Kuru book has no two-sided mid-price, the keeper can bootstrap its first quotes from the strategy's Stork MON/USD and USDC/USD feeds. It rejects future or stale feed values, and the on-chain strategy still applies its own oracle age and price-deviation checks to every order.

Quote sizing reads Kuru's live minimum order size and adds a 10% price cushion. The Monad testnet runner defaults to a configurable 50% per-side NAV cap (`FLUX_MAX_ORDER_NOTIONAL_FRACTION`), which brings the current Kuru market's minimum viable NAV to about $11 instead of roughly $108 under the old 5% cap. This is testnet sizing only; it does not source the market's quote token or prove a profitable strategy.

<!-- __APPEND_MARKER__ -->

## Live deployment

| | |
|---|---|
| **Network** | Monad testnet (chain ID `10143`) |
| **FluxStrategyVault (Circle USDC)** | [`0x67f5787E44A42BBb12fdA9A3a9142Bd6cEEffb42`](https://testnet.monadexplorer.com/address/0x67f5787E44A42BBb12fdA9A3a9142Bd6cEEffb42) |
| **KuruMarginStrategy** | [`0x1AC5d862e48001b139070F9A64F9dd164B6A6d1B`](https://testnet.monadexplorer.com/address/0x1AC5d862e48001b139070F9A64F9dd164B6A6d1B) |
| **Kuru MON/Circle-USDC market** | [`0x9aaf57ae35Be175afB906dc4290FD5a1F6eA7897`](https://testnet.monadexplorer.com/address/0x9aaf57ae35Be175afB906dc4290FD5a1F6eA7897) |
| **Vault asset and Kuru quote token (Circle testnet USDC)** | [`0x534b2f3A21130d7a60830c2Df862319e593943A3`](https://testnet.monadexplorer.com/address/0x534b2f3A21130d7a60830c2Df862319e593943A3) |
| **FluxVault (custody-based)** | [`0x7e974626f6767c3A9ddA8A5b664301CAD5a6B879`](https://testnet.monadexplorer.com/address/0x7e974626f6767c3A9ddA8A5b664301CAD5a6B879) |
| **FluxVault (legacy)** | [`0x87D7e8ADc960B554483d4CEed5305B15b1D3B600`](https://testnet.monadexplorer.com/address/0x87D7e8ADc960B554483d4CEed5305B15b1D3B600) |
| **USDC (mock "Test USD", mintable)** | [`0xdf5b718d8fcc173335185a2a1513ee8151e3c027`](https://testnet.monadexplorer.com/address/0xdf5b718d8fcc173335185a2a1513ee8151e3c027) |
| **Deployment status** | Circle-USDC Kuru market and strategy vault are deployed; strategy is registered. A 12-USDC smoke cycle (quote, 0.1 MON fill, unwind, withdraw) reconciled to −12 units; the book is otherwise empty and no revenue is proven. App deposits remain paused until repeated fills show net revenue. |
| **Share token** | FLUX-LP (6 decimals, transferable, priced at NAV) |
| **Explorer** | https://testnet.monadexplorer.com |

## Verified smoke cycle (Monad testnet, Oct 14 2026)

12 Circle testnet USDC in, full USDC-out path exercised: deposit → allocate 6 to `KuruMarginStrategy` → keeper bid 225 MON (order #3, Stork-bootstrapped) → 0.1 MON taker fill at raw price 2440000 → cancel → taker bid-back → `emergencyExit` → withdraw → vault re-paused. Owner ended with 19.999988 of 20 USDC (−6 units maker fee/dust, −0.01 taker top-up, swept back). Key txs: deposit `0xe5754b77…`, allocate `0x59101b80…`, fill `0x86864545…`, daemon quote (block ~70820900), exit `0x6ff235b5…`, withdraw `0xde3d3155…`.

Findings: the keeper's `$5` minimum-notional floor needs vault NAV ≥ ~$11 to quote on this dust-minimum market; `placeOrders` now tick-aligns prices to Kuru's `tickSize` (fix in `strategy/src/venues/kuru-vault.ts` — every unaligned quote reverted on-chain); Kuru locks quote for resting bids, so free margin reads low while quoting and restores on cancel. No spread was captured and no revenue is proven.

## Hackathon tracks

- Flux is a testnet prototype. It does not currently provide earnings or accept deposits through the strategy-vault frontend.

## Sponsor bounties targeted

- Kuru is deployed, registered, and has completed a first funded trade-and-unwind cycle at tiny size, but has not demonstrated net revenue. Perpl remains a separate experimental adapter and is not connected to the strategy vault.
- Aurora Intents (any-chain deposits): the frontend has a quote → deposit-address → status flow delivering USDC on Monad via the 1Click API (`app/api/intents/*`, `components/IntentsDeposit.tsx`). Needs a server `INTENTS_API_KEY` to go live; Intents serves Monad mainnet, so testnet-vault delivery waits on testnet asset support.

## Tech stack

- **Contracts** — Solidity `^0.8.20`, OpenZeppelin (ERC20 / ReentrancyGuard / SafeERC20 / Math), Foundry (forge/cast) for build, test and deploy.
- **Strategy engine** — TypeScript Kuru keeper routes order actions through the vault and adapter; it is not running and the vault has no allocated capital. Perpl remains a separate experimental adapter.
- **Frontend** — Next.js 14 (App Router) + React 18 + TypeScript, wagmi v2 / viem v2, RainbowKit, Tailwind CSS v3 with a token-driven design system, framer-motion.

<!-- __APPEND_MARKER_2__ -->

## Repository layout

```
Flux/
├── src/FluxVault.sol         # cash-only vault
├── src/FluxStrategyVault.sol # strategy-aware share vault
├── src/venues/               # venue strategy contracts
├── script/DeployFluxKuru.s.sol # Kuru testnet deployment
├── test/FluxVault.t.sol      # Foundry tests
├── strategy/                 # TypeScript market-making engine
│   └── src/                  # index, strategy, perpl, kuru, vault
└── frontend/                 # Next.js 14 dApp (landing, deposit/withdraw, live stats)
```

## Running locally

**1. Contracts (Foundry)**

```bash
forge build
forge test
```

**2. Strategy engine**

```bash
cd strategy
npm install
cp .env.example .env   # keep this local; it may contain the keeper key
npm run build
npm start
```

**3. Frontend**

```bash
cd frontend
npm install
cp .env.example .env.local   # optional: NEXT_PUBLIC_WC_PROJECT_ID, NEXT_PUBLIC_MONAD_RPC, NEXT_PUBLIC_VAULT_ADDRESS, NEXT_PUBLIC_VAULT_ASSET_ADDRESS
npm run dev                  # http://localhost:3000
```

Injected wallets (MetaMask, Rabby) work out of the box; the WalletConnect QR / mobile flow needs a real `NEXT_PUBLIC_WC_PROJECT_ID` from [cloud.walletconnect.com](https://cloud.walletconnect.com). The RPC defaults to `https://testnet-rpc.monad.xyz`.

<!-- __APPEND_MARKER_3__ -->

## Demo script — the full lifecycle (deposit → withdrawal)

1. **Connect.** Open the app, connect a wallet with RainbowKit, and switch to Monad testnet (chain ID `10143`).
2. **Inspect the vault.** The default dashboard reads `FluxStrategyVault.totalAssets()`, including any fresh NAV reported by registered strategies.
3. **Deposit.** Disabled in the frontend until the Kuru flow completes a funded testnet cycle.
4. **Strategy verification.** Use a small owner-approved test amount to allocate to Kuru, place and cancel orders, unwind, withdraw, and reconcile balances and NAV.
5. **Older vaults.** Set `NEXT_PUBLIC_VAULT_ADDRESS` and `NEXT_PUBLIC_VAULT_ASSET_ADDRESS` together to inspect an older deployment. Verify both addresses before using its withdrawal flow.

---

*Testnet only. Not investment advice. No capital has been allocated and Flux has not demonstrated strategy revenue.*
