// index.ts — Flux strategy entry point (testnet only).
//
// Wires the venue clients + vault together, starts the market maker, and
// installs a graceful shutdown that cancels all resting orders on SIGINT/SIGTERM.
import dotenv from 'dotenv';
import { PerplClient } from './perpl.js';
import { KuruClient } from './kuru.js';
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
  // --- Perpl (perps venue, testnet) ---
  const perplAccountId = optionalEnv('PERPL_ACCOUNT_ID');
  const perpl = new PerplClient({
    apiUrl: requireEnv('PERPL_API_URL'),
    wsUrl: requireEnv('PERPL_WS_URL'),
    chainId: requireEnv('PERPL_CHAIN_ID'),
    apiKey: optionalEnv('PERPL_API_KEY'),
    apiSecret: optionalEnv('PERPL_API_KEY_SECRET'),
    rpcUrl: requireEnv('PERPL_RPC_URL'),
    accountId: perplAccountId ? Number(perplAccountId) : undefined,
    marketId: 16, // BTC market on testnet
  });

  // --- Kuru (on-chain CLOB, testnet) ---
  const kuruMarketAddress = optionalEnv('KURU_MARKET_ADDRESS');
  const kuru = new KuruClient(requireEnv('KURU_RPC_URL'), optionalEnv('VAULT_OWNER_PRIVATE_KEY'));

  // --- FluxVault (Phase 1 contract) ---
  const vault = new VaultClient({
    rpcUrl: requireEnv('PERPL_RPC_URL'),
    vaultAddress: requireEnv('VAULT_CONTRACT_ADDRESS'),
    ownerPrivateKey: requireEnv('VAULT_OWNER_PRIVATE_KEY'),
  });

  const marketMaker = new MarketMaker(perpl, kuru, vault, { kuruMarketAddress, cycleIntervalMs: 8000 });

  await perpl.connect();
  marketMaker.start();

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n[${new Date().toISOString()}] received ${signal}, shutting down…`);
    try {
      await marketMaker.stop();
      console.log(`[${new Date().toISOString()}] shutdown complete — all orders cancelled`);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] shutdown failed — orders may still be open:`, err);
      process.exit(1);
    } finally {
      perpl.close();
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
