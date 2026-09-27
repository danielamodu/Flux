// index.ts — Flux strategy entry point (testnet only).
//
// Wires the venue adapters + vault together, starts the market maker, and
// installs a graceful shutdown that unwinds all venues on SIGINT/SIGTERM.
// Venues are a plain list: add an adapter here and the engine quotes it too.
import dotenv from 'dotenv';
import { PerplAdapter, KuruAdapter, CloberAdapter, type VenueAdapter } from './venues/index.js';
import { VaultClient } from './vault.js';
import { MarketMaker } from './strategy.js';

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

async function main(): Promise<void> {
  // --- Perpl (perps venue, testnet) — the reference/mid venue (must be first). ---
  const perplAccountId = optionalEnv('PERPL_ACCOUNT_ID');
  const perpl = new PerplAdapter({
    apiUrl: requireEnv('PERPL_API_URL'),
    wsUrl: requireEnv('PERPL_WS_URL'),
    chainId: requireEnv('PERPL_CHAIN_ID'),
    apiKey: optionalEnv('PERPL_API_KEY'),
    apiSecret: optionalEnv('PERPL_API_KEY_SECRET'),
    rpcUrl: requireEnv('PERPL_RPC_URL'),
    accountId: perplAccountId ? Number(perplAccountId) : undefined,
    marketId: 16, // BTC market on testnet
  });

  // --- Kuru (on-chain CLOB, testnet). A missing key surfaces in connect() so
  //     start() just skips Kuru and keeps quoting on Perpl. ---
  const kuru = new KuruAdapter({
    rpcUrl: optionalEnv('KURU_RPC_URL') || requireEnv('PERPL_RPC_URL'),
    privateKey: optionalEnv('VAULT_OWNER_PRIVATE_KEY'),
    marketAddress: requireEnv('KURU_MARKET_ADDRESS'),
    usdcAddress: requireEnv('KURU_USDC_ADDRESS'),
    marginAccount: requireEnv('KURU_MARGIN_ACCOUNT'),
  });

  // --- FluxVault (Phase 1 contract) ---
  const vault = new VaultClient({
    rpcUrl: requireEnv('PERPL_RPC_URL'),
    vaultAddress: requireEnv('VAULT_CONTRACT_ADDRESS'),
    ownerPrivateKey: requireEnv('VAULT_OWNER_PRIVATE_KEY'),
  });

  // CloberAdapter ready — enable when testnet redeploys (not yet on Monad).
  void CloberAdapter;

  // Perpl leads the list: MarketMaker takes its mid as the reference price.
  const venues: VenueAdapter[] = [perpl, kuru];
  const marketMaker = new MarketMaker(venues, vault, { cycleIntervalMs: 8000 });

  // start() connects every venue, skips any that fail, throws if none do.
  await marketMaker.start();

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n[${new Date().toISOString()}] received ${signal}, shutting down…`);
    try {
      await marketMaker.stop();
      console.log(`[${new Date().toISOString()}] shutdown complete — all orders cancelled`);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] shutdown failed — orders may still be open:`, err);
      process.exit(1);
    } finally {
      for (const v of venues) v.close();
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('fatal error starting Flux strategy:', err);
  process.exit(1);
});
