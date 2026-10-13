// wagmi + RainbowKit configuration. One chain (Monad testnet) defined inline so
// we never depend on a specific viem version shipping it. `ssr: true` lets the
// app pre-render safely; hooks hydrate on the client.
import { defineChain, http } from 'viem';
import { getDefaultConfig } from '@rainbow-me/rainbowkit';

const RPC_URL =
  process.env.NEXT_PUBLIC_MONAD_RPC?.trim() || 'https://testnet-rpc.monad.xyz';

export const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: {
    default: { name: 'Monad Explorer', url: 'https://testnet.monadexplorer.com' },
  },
  testnet: true,
});

// WalletConnect Cloud project id. Any string lets the app build and injected
// wallets (MetaMask, Rabby) connect; the WalletConnect QR flow needs a real id
// from https://cloud.walletconnect.com — set NEXT_PUBLIC_WC_PROJECT_ID.
const projectId =
  process.env.NEXT_PUBLIC_WC_PROJECT_ID?.trim() || 'flux_monad_testnet_demo';

export const wagmiConfig = getDefaultConfig({
  appName: 'Flux',
  projectId,
  chains: [monadTestnet],
  transports: { [monadTestnet.id]: http(RPC_URL) },
  ssr: true,
});
