import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  metadataBase: new URL('https://flux.finance'),
  title: {
    default: 'Flux — The passive liquidity layer for Monad',
    template: '%s · Flux',
  },
  description:
    'Deposit USDC. Earn yield from market making across Monad’s DEXs. Automatically.',
  applicationName: 'Flux',
  openGraph: {
    type: 'website',
    title: 'Flux — The passive liquidity layer for Monad',
    description:
      'Deposit USDC. Earn yield from market making across Monad’s DEXs. Automatically.',
    siteName: 'Flux',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Flux — The passive liquidity layer for Monad',
    description:
      'Deposit USDC. Earn yield from market making across Monad’s DEXs. Automatically.',
  },
  icons: { icon: '/favicon.ico' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
