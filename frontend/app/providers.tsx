'use client';
// Client provider tree. Wagmi needs a QueryClient; RainbowKit needs both plus its
// own theme. VaultDataProvider sits inside so every view shares one set of RPC
// polls. The QueryClient lives in state so it survives re-renders but is created
// once per browser session.
import { useState, type ReactNode } from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, lightTheme } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import { wagmiConfig } from '@/lib/wagmi';
import { VaultDataProvider } from '@/lib/vault-data';

const fluxTheme = lightTheme({
  accentColor: '#0070E0',
  accentColorForeground: '#FFFFFF',
  borderRadius: 'medium',
  fontStack: 'system',
  overlayBlur: 'small',
});

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 5_000, retry: 2, refetchOnWindowFocus: false },
        },
      }),
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={fluxTheme} modalSize="compact" initialChain={10143}>
          <VaultDataProvider>{children}</VaultDataProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
