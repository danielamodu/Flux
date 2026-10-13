# Flux

**A Monad vault prototype with on-chain share accounting.** Deposits are enabled on the redeployed custody-based vault; venue strategies remain paused pending custody-integrated execution.

---

## What is Flux?

Flux is a Monad testnet prototype. The updated `FluxVault.sol` issues transferable **FLUX-LP** shares against USDC held by the vault. External venue balances and unrealized PnL do not count toward NAV; strategy proceeds count only after USDC is settled back to the vault. The legacy deployment remains available for existing holders, while the frontend points to the new custody-based deployment.

## The problem it solves

Automated market making adds inventory, adverse-selection, and operational risks. Flux does not currently run depositor capital on venues or claim strategy yield. Those capabilities require contract-controlled funding, verifiable valuation, and a tested unwind path.

## How it works

`FluxVault.sol` derives NAV from the actual USDC balance. Deposits mint shares proportionally to that balance; withdrawals burn shares and transfer only available USDC. A pre-seeded balance is assigned to permanently locked shares so the first depositor cannot capture it. The strategy runner is paused: current Perpl and Kuru adapters use separately funded accounts and cannot safely control or redeem assets for this vault. The updated source has no owner-settable NAV function.

<!-- __APPEND_MARKER__ -->

## Live deployment

| | |
|---|---|
| **Network** | Monad testnet (chain ID `10143`) |
| **FluxVault (custody-based)** | [`0x7e974626f6767c3A9ddA8A5b664301CAD5a6B879`](https://testnet.monadexplorer.com/address/0x7e974626f6767c3A9ddA8A5b664301CAD5a6B879) |
| **FluxVault (legacy)** | [`0x87D7e8ADc960B554483d4CEed5305B15b1D3B600`](https://testnet.monadexplorer.com/address/0x87D7e8ADc960B554483d4CEed5305B15b1D3B600) |
| **USDC (mock "Test USD", mintable)** | [`0xdf5b718d8fcc173335185a2a1513ee8151e3c027`](https://testnet.monadexplorer.com/address/0xdf5b718d8fcc173335185a2a1513ee8151e3c027) |
| **Deployment status** | Custody-based source deployed; new deposits use this address. The legacy contract has owner-set NAV and must not receive deposits. |
| **Share token** | FLUX-LP (6 decimals, transferable, priced at NAV) |
| **Explorer** | https://testnet.monadexplorer.com |

## Hackathon tracks

- Track 1 and Track 2 positioning is prototype work only; Flux currently does not provide automated yield or accept new deposits through its frontend.

## Sponsor bounties targeted

- Perpl and Kuru adapters are experimental integrations. They are not enabled in the vault runner and do not contribute to vault NAV.

## Tech stack

- **Contracts** — Solidity `^0.8.20`, OpenZeppelin (ERC20 / ReentrancyGuard / SafeERC20 / Math), Foundry (forge/cast) for build, test and deploy.
- **Strategy engine** — TypeScript adapters for Perpl and Kuru; runner exits safely until custody-compatible funding, valuation, and unwind are implemented.
- **Frontend** — Next.js 14 (App Router) + React 18 + TypeScript, wagmi v2 / viem v2, RainbowKit, Tailwind CSS v3 with a token-driven design system, framer-motion.

<!-- __APPEND_MARKER_2__ -->

## Repository layout

```
Flux/
├── src/FluxVault.sol         # the vault contract
├── script/FluxVault.s.sol    # Foundry deploy script
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
cp .env.example .env   # strategy exits safely until custody integration is complete
npm run build
npm start
```

**3. Frontend**

```bash
cd frontend
npm install
cp .env.example .env.local   # optional: NEXT_PUBLIC_WC_PROJECT_ID, NEXT_PUBLIC_MONAD_RPC, NEXT_PUBLIC_VAULT_ADDRESS
npm run dev                  # http://localhost:3000
```

Injected wallets (MetaMask, Rabby) work out of the box; the WalletConnect QR / mobile flow needs a real `NEXT_PUBLIC_WC_PROJECT_ID` from [cloud.walletconnect.com](https://cloud.walletconnect.com). The RPC defaults to `https://testnet-rpc.monad.xyz`.

<!-- __APPEND_MARKER_3__ -->

## Demo script — the full lifecycle (deposit → withdrawal)

1. **Connect.** Open the app, connect a wallet with RainbowKit, and switch to Monad testnet (chain ID `10143`).
2. **Inspect the vault.** Dashboard data reads the custody-based deployment. `totalAssets` counts only USDC held by the vault; venue positions and strategy yield are not included.
3. **Deposit.** Approve the displayed USDC token and deposit into the new vault. Shares are issued against its on-chain USDC balance.
4. **Withdraw.** Redeem shares for available USDC held by the vault. Strategy funds are not included because venue execution is paused.
5. **Legacy shares.** Existing holders can set `NEXT_PUBLIC_VAULT_ADDRESS` to the legacy address to use its withdrawal flow; deposits stay disabled for that address. Verify the on-chain quote and available USDC before withdrawing.

---

*Testnet only. Not investment advice. Deposits are enabled on the custody-based vault; the strategy runner remains paused.*
