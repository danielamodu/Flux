import dotenv from 'dotenv';
import { ethers } from 'ethers';

dotenv.config();
dotenv.config({ path: '../.env', override: false });

const EXPECTED_CHAIN_ID = 10143n;
const STORK_TESTNET_RECEIVER = '0xacC0a0cF13571d30B4b8637996F5D6D774d4fd62';
const MON_USD_FEED_ID = '0xa4f6b07ae0c89e3f3cc03c1badcc3e9adffdf7206bafcd56d142979800887385';
const USDC_USD_FEED_ID = '0x7416a56f222e196d0487dce8a1a8003936862e7a15092a91898d69fa8bce290c';
const ADDRESS_ABI = new ethers.Interface([
  'function getMarketParams() view returns (uint32 pricePrecision,uint96 sizePrecision,address baseToken,uint256 baseDecimals,address quoteToken,uint256 quoteDecimals,uint32 tickSize,uint96 minSize,uint96 maxSize,uint256 takerFeeBps,uint256 makerFeeBps)',
  'function usdc() view returns (address)',
  'function asset() view returns (address)',
]);
const STORK_ABI = new ethers.Interface([
  'function getTemporalNumericValueV1(bytes32 id) view returns ((uint64 timestampNs,int192 quantizedValue) value)',
]);

function envAddress(name: string, optional = false): string | undefined {
  const value = process.env[name]?.trim();
  if (!value && optional) return undefined;
  if (!value || !ethers.isAddress(value)) throw new Error(`${name} is missing or is not an EVM address`);
  return ethers.getAddress(value);
}

async function main(): Promise<void> {
  const rpcUrl = process.env.KURU_RPC_URL?.trim();
  if (!rpcUrl) throw new Error('KURU_RPC_URL is missing');

  const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, { staticNetwork: false });
  let network: ethers.Network;
  try {
    network = await provider.getNetwork();
  } catch {
    throw new Error('RPC could not be reached or did not return a valid chain ID; check KURU_RPC_URL and DNS/network access');
  }
  console.log(`Connected chain ID: ${network.chainId}`);
  if (network.chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(`Wrong network: expected Monad testnet ${EXPECTED_CHAIN_ID}, got ${network.chainId}`);
  }

  const marketAddress = envAddress('KURU_MARKET_ADDRESS')!;
  const marginAddress = envAddress('KURU_MARGIN_ACCOUNT')!;
  const configuredQuote = envAddress('KURU_USDC_ADDRESS', true);
  const storkAddress = envAddress('STORK_ORACLE_ADDRESS')!;
  const configuredMonFeed = process.env.STORK_BASE_USD_FEED_ID?.trim();
  const configuredUsdcFeed = process.env.STORK_QUOTE_USD_FEED_ID?.trim();
  for (const [name, value, expected] of [
    ['STORK_BASE_USD_FEED_ID', configuredMonFeed, MON_USD_FEED_ID],
    ['STORK_QUOTE_USD_FEED_ID', configuredUsdcFeed, USDC_USD_FEED_ID],
  ] as const) {
    if (!value || !ethers.isHexString(value, 32)) throw new Error(`${name} is missing or not a bytes32 value`);
    if (value.toLowerCase() !== expected.toLowerCase()) {
      console.error(`${name} does not match the documented Monad Testnet ${name === 'STORK_BASE_USD_FEED_ID' ? 'MON/USD' : 'USDC/USD'} feed`);
      process.exitCode = 1;
    }
  }
  const oldVaultAddress = envAddress('VAULT_CONTRACT_ADDRESS', true);
  const strategyVaultAddress = envAddress('FLUX_STRATEGY_VAULT_ADDRESS', true);

  const addresses = [
    ['Kuru market', marketAddress],
    ['Kuru MarginAccount', marginAddress],
    ...(configuredQuote ? [['Configured Kuru quote token', configuredQuote] as [string, string]] : []),
    ...(oldVaultAddress ? [['Configured legacy Flux vault', oldVaultAddress] as [string, string]] : []),
    ...(strategyVaultAddress ? [['Configured strategy vault', strategyVaultAddress] as [string, string]] : []),
  ];

  const codeByAddress = new Map<string, string>();
  for (const [label, address] of addresses) {
    let code: string;
    try {
      code = await provider.getCode(address);
    } catch {
      throw new Error(`RPC failed while checking ${label}; no deployment checks were performed`);
    }
    codeByAddress.set(address.toLowerCase(), code);
    console.log(`${label}: ${code === '0x' ? 'NO CONTRACT CODE' : 'contract code found'} (${address})`);
  }

  const marketCode = codeByAddress.get(marketAddress.toLowerCase());
  if (!marketCode || marketCode === '0x') {
    throw new Error('Configured Kuru market is not deployed on current Monad testnet; obtain the current market address before deployment');
  }

  let market: ethers.Result;
  try {
    const raw = await provider.call({ to: marketAddress, data: ADDRESS_ABI.encodeFunctionData('getMarketParams') });
    market = ADDRESS_ABI.decodeFunctionResult('getMarketParams', raw);
  } catch {
    throw new Error('KURU_MARKET_ADDRESS has code but does not expose the expected Kuru getMarketParams ABI');
  }

  const baseToken = ethers.getAddress(String(market.baseToken));
  const quoteToken = ethers.getAddress(String(market.quoteToken));
  console.log(`Live market base token: ${baseToken}`);
  console.log(`Live market quote token (vault asset must match): ${quoteToken}`);
  console.log(`Market precisions: price=${market.pricePrecision}, size=${market.sizePrecision}; token decimals base=${market.baseDecimals}, quote=${market.quoteDecimals}`);

  if (configuredQuote && quoteToken.toLowerCase() !== configuredQuote.toLowerCase()) {
    console.error(`MISMATCH: KURU_USDC_ADDRESS is ${configuredQuote}, but the live market quote token is ${quoteToken}`);
    process.exitCode = 1;
  }

  const storkCode = await provider.getCode(storkAddress);
  console.log(`Monad testnet Stork receiver: ${storkCode === '0x' ? 'NO CONTRACT CODE' : 'contract code found'} (${storkAddress})`);
  if (storkAddress.toLowerCase() !== STORK_TESTNET_RECEIVER.toLowerCase()) {
    console.error(`STORK_ORACLE_ADDRESS must use the documented Monad Testnet receiver ${STORK_TESTNET_RECEIVER}`);
    process.exitCode = 1;
  }
  if (storkCode === '0x') {
    console.error('Official Stork receiver has no code on the configured network');
    process.exitCode = 1;
  } else {
    const latestBlock = await provider.getBlock('latest');
    for (const pair of ['MON/USD', 'USDC/USD'] as const) {
      try {
        const configuredFeedId = pair === 'MON/USD' ? configuredMonFeed! : configuredUsdcFeed!;
        const data = STORK_ABI.encodeFunctionData('getTemporalNumericValueV1', [configuredFeedId]);
        const result = STORK_ABI.decodeFunctionResult(
          'getTemporalNumericValueV1',
          await provider.call({ to: STORK_TESTNET_RECEIVER, data }),
        )[0];
        const timestamp = Number(result.timestampNs / 1_000_000_000n);
        const age = latestBlock ? latestBlock.timestamp - timestamp : -1;
        const price = Number(result.quantizedValue) / 1e18;
        console.log(`Stork ${pair}: price=$${price}, age=${age}s`);
        if (price <= 0 || age < 0 || age > 3600) {
          console.error(`Stork ${pair} value is invalid or older than its documented 3600s maximum`);
          process.exitCode = 1;
        }
      } catch {
        console.error(`Stork ${pair}: no readable fresh on-chain value`);
        process.exitCode = 1;
      }
    }
  }

  for (const [label, vaultAddress] of [
    ...(oldVaultAddress ? [['Configured legacy Flux vault', oldVaultAddress] as [string, string]] : []),
    ...(strategyVaultAddress ? [['Configured strategy vault', strategyVaultAddress] as [string, string]] : []),
  ]) {
    if (codeByAddress.get(vaultAddress.toLowerCase()) === '0x') continue;
    let asset: string | undefined;
    for (const method of ['asset', 'usdc']) {
      try {
        const data = ADDRESS_ABI.encodeFunctionData(method);
        asset = ethers.getAddress(ADDRESS_ABI.decodeFunctionResult(method, await provider.call({ to: vaultAddress, data }))[0]);
        break;
      } catch {
        // Legacy and strategy vaults expose different underlying-asset getters.
      }
    }
    if (!asset) {
      console.error(`${label} has code but no recognized asset getter`);
      process.exitCode = 1;
      continue;
    }
    console.log(`${label} asset: ${asset}`);
    if (asset.toLowerCase() !== quoteToken.toLowerCase()) {
      if (label === 'Configured legacy Flux vault') {
        console.warn(`EXPECTED MISMATCH: the legacy vault uses a different asset and must not be connected to this Kuru market; deploy a fresh strategy vault`);
      } else {
        console.error(`MISMATCH: ${label} asset differs from the live Kuru market quote token`);
        process.exitCode = 1;
      }
    }
  }

  if (process.exitCode === 1) {
    console.error('Fix the reported address mismatch before deploying or allocating funds.');
  } else {
    console.log('Market, vault asset, and Stork feed checks passed. A fresh empty strategy vault is ready for deployment when explicitly requested.');
  }
  await provider.destroy();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Configuration verification failed');
  process.exitCode = 1;
});
