// Flux Kuru market-making runner. Order transactions go through the keeper-gated
// FluxStrategyVault and its KuruMarginStrategy; this process never holds user funds.
import dotenv from 'dotenv';
import { MarketMaker } from './strategy.js';
import { VaultClient } from './vault.js';
import { KuruVaultAdapter } from './venues/kuru-vault.js';

dotenv.config();
dotenv.config({ path: '../.env', override: false });

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

async function main(): Promise<void> {
  const rpcUrl = required('KURU_RPC_URL');
  const vaultAddress = required('FLUX_STRATEGY_VAULT_ADDRESS');
  const strategyAddress = required('KURU_STRATEGY_ADDRESS');
  const marketAddress = required('KURU_MARKET_ADDRESS');
  const orderScanStartBlock = Number(required('KURU_ORDER_SCAN_START_BLOCK'));
  const keeperPrivateKey = required('VAULT_OWNER_PRIVATE_KEY');

  const vault = new VaultClient({ rpcUrl, vaultAddress });
  const kuru = new KuruVaultAdapter({
    rpcUrl,
    keeperPrivateKey,
    vaultAddress,
    strategyAddress,
    marketAddress,
    orderScanStartBlock,
  });
  const marketMaker = new MarketMaker([kuru], vault, { unwindOnStop: true });
  await marketMaker.start();
  console.log('Flux Kuru keeper is running. Press Ctrl+C to stop quoting.');

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal} received; cancelling Flux Kuru orders...`);
    try {
      await marketMaker.stop();
    } finally {
      kuru.close();
    }
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error('Flux Kuru keeper failed to start:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
