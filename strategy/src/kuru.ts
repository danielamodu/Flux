// kuru.ts — Kuru on-chain CLOB client (testnet only).
//
// ETHERS VERSION BOUNDARY: @kuru-labs/kuru-sdk (0.0.95) is built against ethers
// v5; its static methods expect v5 provider/signer + BigNumber types. The rest
// of this project uses ethers v6. We build a v6 provider/wallet and bridge to
// the SDK's expected shape with a single cast at the boundary. The exact SDK
// parameter types are derived from the SDK's own signatures so we never guess.
import { ethers } from 'ethers';
import * as KuruSdk from '@kuru-labs/kuru-sdk';
import type { LIMIT, MarketParams, OrderBookData } from '@kuru-labs/kuru-sdk';

export type Side = 'bid' | 'ask';

// Types the SDK actually expects, extracted from its own signatures (ethers v5).
type SdkProviderOrSigner = Parameters<typeof KuruSdk.ParamFetcher.getMarketParams>[0];
type SdkOrderId = Parameters<typeof KuruSdk.OrderCanceler.cancelOrders>[2][number];

export class KuruClient {
  private readonly provider: ethers.JsonRpcProvider;
  private readonly wallet: ethers.Wallet | undefined;
  private readonly signerOrProvider: SdkProviderOrSigner;
  private readonly paramCache = new Map<string, MarketParams>();
  private openOrderIds: SdkOrderId[] = [];

  constructor(rpcUrl: string, privateKey?: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.wallet = privateKey ? new ethers.Wallet(privateKey, this.provider) : undefined;
    // Single, deliberate bridge from ethers v6 -> the v5 shape the SDK wants.
    this.signerOrProvider = (this.wallet ?? this.provider) as unknown as SdkProviderOrSigner;
  }

  private async marketParams(market: string): Promise<MarketParams> {
    const cached = this.paramCache.get(market);
    if (cached) return cached;
    const params = await KuruSdk.ParamFetcher.getMarketParams(this.signerOrProvider, market);
    this.paramCache.set(market, params);
    return params;
  }

  /** Mid price = midpoint of best bid and best ask from the L2 book. */
  async getMidPrice(market: string): Promise<number> {
    const params = await this.marketParams(market);
    const book: OrderBookData = await KuruSdk.OrderBook.getL2OrderBook(this.signerOrProvider, market, params);
    if (book.bids.length === 0 || book.asks.length === 0) {
      throw new Error(`Kuru: empty order book for ${market}`);
    }
    return (book.bids[0][0] + book.asks[0][0]) / 2;
  }

  /** Place a post-only (GTC) limit order. Price/size are strings per the SDK. */
  async placeLimitOrder(market: string, side: Side, price: number, size: number): Promise<void> {
    const params = await this.marketParams(market);
    const order: LIMIT = {
      price: price.toString(),
      size: size.toString(),
      isBuy: side === 'bid',
      postOnly: true,
    };
    await KuruSdk.GTC.placeLimit(this.signerOrProvider, market, params, order);
  }

  /** Cancel any orders we currently track as open on this market. */
  async cancelAllOrders(market: string): Promise<void> {
    if (this.openOrderIds.length === 0) return;
    await KuruSdk.OrderCanceler.cancelOrders(this.signerOrProvider, market, this.openOrderIds);
    this.openOrderIds = [];
  }
}
