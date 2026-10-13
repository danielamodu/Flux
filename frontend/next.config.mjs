/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { webpack }) => {
    // RainbowKit 2.x ships the Base Account connector, which transitively
    // imports @coinbase/cdp-sdk. That SDK references optional @x402/* payment
    // modules (x402 = HTTP-402 pay-per-call) that we neither install nor use —
    // the injected / WalletConnect flows never touch that code path. Left alone
    // they fail webpack with "Module not found". Ignore the whole scope so the
    // bundle builds; the dead imports resolve to empty modules.
    config.plugins.push(
      new webpack.IgnorePlugin({ resourceRegExp: /^@x402\// }),
    );

    // Optional React Native storage adapter reached through @metamask/sdk's
    // browser build — no browser build exists and the web connector never uses
    // it. Alias to an empty module so it doesn't warn on every compile.
    config.resolve.alias = {
      ...config.resolve.alias,
      '@react-native-async-storage/async-storage': false,
    };

    // Common optional deps of the WalletConnect / wagmi stack that have no
    // browser build. Marking them external keeps webpack from trying to bundle
    // them (wagmi's own Next.js guidance).
    config.externals.push('pino-pretty', 'lokijs', 'encoding');

    return config;
  },
};

export default nextConfig;
