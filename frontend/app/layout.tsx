import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  metadataBase: new URL('https://flux.finance'),
  title: {
    default: 'Flux — Market making on Monad',
    template: '%s · Flux',
  },
  description:
    'Flux is building vault-controlled market making across Monad. Testnet prototype; trading is not live.',
  applicationName: 'Flux',
  openGraph: {
    type: 'website',
    title: 'Flux — Market making on Monad',
    description:
      'Flux is building vault-controlled market making across Monad. Testnet prototype; trading is not live.',
    siteName: 'Flux',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Flux — Market making on Monad',
    description:
      'Flux is building vault-controlled market making across Monad. Testnet prototype; trading is not live.',
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
