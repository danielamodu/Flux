// Kuru venue execution routed through FluxStrategyVault -> KuruMarginStrategy.
// This signer must be the vault owner or its configured keeper. It never receives
// depositor tokens or calls Kuru's order book directly.
import { ethers as ethersV5 } from '@kuru-labs/kuru-sdk/node_modules/ethers/lib/index.js';
import * as KuruSdk from '@kuru-labs/kuru-sdk';
import type { MarketParams } from '@kuru-labs/kuru-sdk';
import type { Fill, Order, VenueAdapter } from './types.js';

export interface KuruVaultConfig {
  rpcUrl: string;
  keeperPrivateKey: string;
  vaultAddress: string;
  strategyAddress: string;
  marketAddress: string;
  pair?: string;
}

const VAULT_ABI = [
  'function owner() view returns (address)',
  'function keeper() view returns (address)',
  'function strategies(address) view returns (uint128 assetCap, bool enabled, bool registered)',
  'function rebalance(address strategy, bytes data)',
];
const STRATEGY_ABI = [
  'function baseInventory() view returns (uint256)',
  'function quoteInventory() view returns (uint256)',
];

const ORDERBOOK_EVENTS_ABI = [
  'event OrderCreated(uint40 orderId, address owner, uint96 size, uint32 price, bool isBuy)',
  'event Trade(uint40 orderId, address makerAddress, bool isBuy, uint256 price, uint96 updatedSize, address takerAddress, address txOrigin, uint96 filledSize)',
];

/**
 * Kuru market maker adapter for a deployed FluxStrategyVault and KuruMarginStrategy.
 * Order placement is sent through the vault's keeper-gated method; market-data reads
 * and fill subscriptions remain direct read-only calls to Kuru.
 */
export class KuruVaultAdapter implements VenueAdapter {
  readonly name = 'kuru-vault';
  readonly pair: string;

  private readonly config: KuruVaultConfig;
  private readonly provider: ethersV5.providers.JsonRpcProvider;
  private readonly signer: ethersV5.Wallet;
  private readonly vault: ethersV5.Contract;
  private readonly strategy: ethersV5.Contract;
  private params: MarketParams | undefined;
  private market: ethersV5.Contract | undefined;
  private openOrderIds: ethersV5.BigNumber[] = [];
  private readonly fillBuffer: Fill[] = [];
  private readonly fillListeners = new Set<(fill: Fill) => void>();
  private tradeListener: ((...args: any[]) => void) | undefined;

  constructor(config: KuruVaultConfig) {
    this.config = config;
    this.pair = config.pair ?? 'MON/USDC';
    this.provider = new ethersV5.providers.JsonRpcProvider(config.rpcUrl);
    this.signer = new ethersV5.Wallet(config.keeperPrivateKey, this.provider);
    this.vault = new ethersV5.Contract(config.vaultAddress, VAULT_ABI, this.signer);
    this.strategy = new ethersV5.Contract(config.strategyAddress, STRATEGY_ABI, this.provider);
  }

  async connect(): Promise<void> {
    const [owner, keeper, strategy, params] = await Promise.all([
      this.vault.owner(),
      this.vault.keeper(),
      this.vault.strategies(this.config.strategyAddress),
      KuruSdk.ParamFetcher.getMarketParams(this.provider, this.config.marketAddress),
    ]);
    const signerAddress = this.signer.address.toLowerCase();
    if (signerAddress !== String(owner).toLowerCase() && signerAddress !== String(keeper).toLowerCase()) {
      throw new Error('KuruVaultAdapter signer is not the Flux vault owner or keeper');
    }
    if (!strategy.registered || !strategy.enabled) {
      throw new Error('KuruMarginStrategy is not registered and enabled in FluxStrategyVault');
    }
    this.params = params;

    const market = new ethersV5.Contract(this.config.marketAddress, ORDERBOOK_EVENTS_ABI, this.provider);
    const strategyAddress = this.config.strategyAddress.toLowerCase();
    this.tradeListener = (
      _orderId: ethersV5.BigNumber,
      makerAddress: string,
      isBuy: boolean,
      priceRaw: ethersV5.BigNumber,
      _updatedSize: ethersV5.BigNumber,
      _taker: string,
      _txOrigin: string,
      filledSize: ethersV5.BigNumber,
    ) => {
      if (makerAddress.toLowerCase() === strategyAddress) this.emitFill(isBuy, priceRaw, filledSize);
    };
    market.on('Trade', this.tradeListener);
    this.market = market;
  }

  close(): void {
    if (this.market && this.tradeListener) this.market.off('Trade', this.tradeListener);
    this.market = undefined;
    this.tradeListener = undefined;
    this.provider.removeAllListeners();
    this.fillListeners.clear();
  }

  async getMidPrice(): Promise<number> {
    const params = await this.marketParams();
    const book = await KuruSdk.OrderBook.getL2OrderBook(this.provider, this.config.marketAddress, params);
    if (book.bids.length === 0 || book.asks.length === 0) {
      throw new Error(`Kuru: empty order book for ${this.config.marketAddress}`);
    }
    return (book.bids[0][0] + book.asks[0][0]) / 2;
  }

  async placeOrders(bid: Order, ask: Order): Promise<void> {
    const params = await this.marketParams();
    const priceDecimals = precisionDecimals(params.pricePrecision);
    const sizeDecimals = precisionDecimals(params.sizePrecision);

    // Free Kuru collateral can be tied up by our resting orders. Cancel first so
    // the strategy's on-chain balance guard sees funds released before replacing.
    if (this.openOrderIds.length !== 0) await this.cancelAllOrders();

    const bidPrice = ethersV5.utils.parseUnits(bid.price.toFixed(priceDecimals), priceDecimals);
    const bidSize = ethersV5.utils.parseUnits(bid.size.toFixed(sizeDecimals), sizeDecimals);
    const askPrice = ethersV5.utils.parseUnits(ask.price.toFixed(priceDecimals), priceDecimals);
    const askSize = ethersV5.utils.parseUnits(ask.size.toFixed(sizeDecimals), sizeDecimals);
    const [quoteBalance, baseBalance] = await Promise.all([
      this.strategy.quoteInventory() as Promise<ethersV5.BigNumber>,
      this.strategy.baseInventory() as Promise<ethersV5.BigNumber>,
    ]);
    const quoteNeeded = bidSize
      .mul(bidPrice)
      .mul(ethersV5.BigNumber.from(10).pow(params.quoteAssetDecimals))
      .div(params.sizePrecision.mul(params.pricePrecision));
    const baseNeeded = askSize
      .mul(ethersV5.BigNumber.from(10).pow(params.baseAssetDecimals))
      .div(params.sizePrecision);
    const buyPrices = quoteNeeded.lte(quoteBalance) ? [bidPrice.toString()] : [];
    const buySizes = buyPrices.length ? [bidSize.toString()] : [];
    const sellPrices = baseNeeded.lte(baseBalance) ? [askPrice.toString()] : [];
    const sellSizes = sellPrices.length ? [askSize.toString()] : [];
    if (buyPrices.length === 0 && sellPrices.length === 0) {
      throw new Error('Kuru strategy has insufficient free quote and base balances for either side');
    }

    const encoded = this.encodeRebalance(
      buyPrices,
      buySizes,
      sellPrices,
      sellSizes,
      [],
    );
    const tx = await this.vault.rebalance(this.config.strategyAddress, encoded);
    const receipt = await tx.wait();
    this.openOrderIds = this.parseOrderIds(receipt);
  }

  async getBaseInventory(): Promise<number> {
    const params = await this.marketParams();
    const raw = (await this.strategy.baseInventory()) as ethersV5.BigNumber;
    return Number(ethersV5.utils.formatUnits(raw, params.baseAssetDecimals));
  }

  async cancelAllOrders(): Promise<void> {
    if (this.openOrderIds.length === 0) return;
    const encoded = this.encodeRebalance([], [], [], [], this.openOrderIds.map((id) => id.toString()));
    const tx = await this.vault.rebalance(this.config.strategyAddress, encoded);
    await tx.wait();
    this.openOrderIds = [];
  }

  async getFills(): Promise<Fill[]> {
    return [...this.fillBuffer];
  }

  onFill(callback: (fill: Fill) => void): void {
    this.fillListeners.add(callback);
  }

  private async marketParams(): Promise<MarketParams> {
    if (this.params) return this.params;
    this.params = await KuruSdk.ParamFetcher.getMarketParams(this.provider, this.config.marketAddress);
    return this.params;
  }

  private encodeRebalance(
    buyPrices: string[],
    buySizes: string[],
    sellPrices: string[],
    sellSizes: string[],
    cancelOrderIds: string[],
  ): string {
    const coder = ethersV5.utils.defaultAbiCoder;
    return coder.encode(
      ['tuple(uint32[] buyPrices,uint96[] buySizes,uint32[] sellPrices,uint96[] sellSizes,uint40[] cancelOrderIds)'],
      [{ buyPrices, buySizes, sellPrices, sellSizes, cancelOrderIds }],
    );
  }

  private parseOrderIds(receipt: { logs: Array<{ topics: string[]; data: string }> }): ethersV5.BigNumber[] {
    const iface = new ethersV5.utils.Interface(ORDERBOOK_EVENTS_ABI);
    const strategy = this.config.strategyAddress.toLowerCase();
    const ids: ethersV5.BigNumber[] = [];
    for (const log of receipt.logs ?? []) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed.name === 'OrderCreated' && String(parsed.args.owner).toLowerCase() === strategy) {
          ids.push(ethersV5.BigNumber.from(parsed.args.orderId));
        }
      } catch {
        // Ignore logs emitted by the vault, strategy, and unrelated contracts.
      }
    }
    return ids;
  }

  private emitFill(takerIsBuy: boolean, priceRaw: ethersV5.BigNumber, sizeRaw: ethersV5.BigNumber): void {
    if (!this.params) return;
    const price = Number(priceRaw.toString()) / Number(this.params.pricePrecision.toString());
    const size = Number(sizeRaw.toString()) / Number(this.params.sizePrecision.toString());
    const side: 'bid' | 'ask' = takerIsBuy ? 'ask' : 'bid';
    const fee = (price * size * Number(this.params.makerFeeBps.toString())) / 10_000;
    const fill: Fill = { side, price, size, fee, timestamp: Date.now() };
    this.fillBuffer.push(fill);
    for (const callback of this.fillListeners) callback(fill);
  }
}

function precisionDecimals(value: ethersV5.BigNumber): number {
  const text = value.toString();
  if (!/^10*$/.test(text)) throw new Error(`Kuru precision is not a power of 10: ${text}`);
  return text.length - 1;
}
