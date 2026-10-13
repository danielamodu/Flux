// kuru.ts — Kuru on-chain CLOB venue adapter (Monad testnet).
//
// ETHERS VERSION BOUNDARY (isolated to THIS file): @kuru-labs/kuru-sdk@0.0.95
// is built against ethers v5 and bundles ethers 5.7.1 at
// node_modules/@kuru-labs/kuru-sdk/node_modules/ethers. The rest of the Flux
// engine runs ethers v6. Rather than cast v6 objects into v5-shaped holes, we
// import the *exact* ethers instance the SDK itself uses and build genuine v5
// provider/wallet/BigNumber values here. Neither the SDK's package.json nor
// that nested ethers declares an `exports` map. We import its explicit CJS entry
// (/lib/index.js): tsc (moduleResolution: bundler) resolves the adjacent
// lib/index.d.ts so the types line up with the SDK's own signatures with zero
// casts, and Node ESM loads the very same 5.7.1 instance the SDK's
// `require('ethers')` caches. A bare directory specifier compiles but throws
// ERR_UNSUPPORTED_DIR_IMPORT at runtime — Node ESM does not do directory imports.
import { ethers as ethersV5 } from '@kuru-labs/kuru-sdk/node_modules/ethers/lib/index.js';
import * as KuruSdk from '@kuru-labs/kuru-sdk';
import type { LIMIT, BATCH, MarketParams } from '@kuru-labs/kuru-sdk';
import type { Order, Fill, VenueAdapter } from './types.js';

export interface KuruConfig {
  rpcUrl: string;
  privateKey: string;
  /** Order-book (market) contract address to quote on. */
  marketAddress: string;
  /** Quote-asset (USDC) token address, custodied by the MarginAccount. */
  usdcAddress: string;
  /** MarginAccount contract that holds maker balances. */
  marginAccount: string;
  /** Canonical market pair; must match the reference venue before quoting. */
  pair?: string;
  /** Keep at least this much quote (human USDC) in the MarginAccount. */
  minMarginUsdc?: number;
}

// Human-readable fragments for the two OrderBook events we consume; the types
// and order match Kuru's OrderBook ABI exactly (param names are cosmetic).
const ORDERBOOK_EVENTS_ABI: string[] = [
  'event OrderCreated(uint40 orderId, address owner, uint96 size, uint32 price, bool isBuy)',
  'event Trade(uint40 orderId, address makerAddress, bool isBuy, uint256 price, uint96 updatedSize, address takerAddress, address txOrigin, uint96 filledSize)',
];

export class KuruAdapter implements VenueAdapter {
  readonly name = 'kuru';
  readonly pair: string;

  private readonly config: KuruConfig;
  private readonly provider: ethersV5.providers.JsonRpcProvider;
  private readonly wallet: ethersV5.Wallet | undefined;
  private readonly minMarginUsdc: number;

  private params: MarketParams | undefined;
  private market: ethersV5.Contract | undefined; // Trade/OrderCreated event source
  private openOrderIds: ethersV5.BigNumber[] = [];
  private readonly fillBuffer: Fill[] = [];
  private readonly fillListeners = new Set<(fill: Fill) => void>();

  constructor(config: KuruConfig) {
    this.config = config;
    this.pair = config.pair ?? 'MON/USDC';
    this.provider = new ethersV5.providers.JsonRpcProvider(config.rpcUrl);
    // Construct the signer lazily-safely: an absent key must not crash the whole
    // engine at startup — connect() surfaces it so MarketMaker can skip Kuru and
    // keep quoting on Perpl. Reads (getMidPrice) work provider-only.
    this.wallet = config.privateKey ? new ethersV5.Wallet(config.privateKey, this.provider) : undefined;
    this.minMarginUsdc = config.minMarginUsdc ?? 50;
  }

  /** The signer, or a clear error when no key was provided. */
  private signer(): ethersV5.Wallet {
    if (!this.wallet) throw new Error('KuruAdapter requires VAULT_OWNER_PRIVATE_KEY to sign transactions');
    return this.wallet;
  }

  async connect(): Promise<void> {
    const signer = this.signer();
    // 1. Load on-chain market parameters (precisions, decimals, fees). These are
    //    reads: the SDK calls the contract with { from: AddressZero }, and ethers
    //    v5 forbids a `from` override on a Signer-connected Contract
    //    (UNSUPPORTED_OPERATION). Pass the Provider so the override is legal;
    //    the Signer is only needed for the write (MarginDeposit.deposit) below.
    this.params = await KuruSdk.ParamFetcher.getMarketParams(this.provider, this.config.marketAddress);
    const quoteDecimals = Number(this.params.quoteAssetDecimals.toString());

    // 2. Require existing MarginAccount funds. Kuru
    //    maker orders consume MarginAccount balances, so the quote (USDC) side
    //    must be funded before we can rest bids. This adapter never moves funds.
    const balance = await KuruSdk.MarginBalance.getBalance(
      this.provider,
      this.config.marginAccount,
      signer.address,
      this.config.usdcAddress,
    );
    const minUnits = ethersV5.utils.parseUnits(this.minMarginUsdc.toString(), quoteDecimals);
    if (balance.lt(minUnits)) {
      throw new Error(
        `Kuru MarginAccount has ${ethersV5.utils.formatUnits(balance, quoteDecimals)} USDC; ` +
          `${this.minMarginUsdc} required. Automatic wallet funding is disabled.`,
      );
    }
    this.log(`connected with margin USDC ${ethersV5.utils.formatUnits(balance, quoteDecimals)}`);

    // 3. Stream Trade events for our maker address to surface fills.
    this.subscribeFills(signer.address);
    this.log(`connected — market ${this.config.marketAddress}`);
  }

  close(): void {
    this.market?.removeAllListeners();
    this.market = undefined;
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

  /**
   * Rest a two-sided post-only quote in a single atomic batchUpdate that also
   * cancels our previously-tracked orders (cancel + replace in one tx). New
   * order IDs are recovered from the OrderCreated logs so cancelAllOrders() and
   * the next replace can reference them.
   */
  async placeOrders(bid: Order, ask: Order): Promise<void> {
    const params = await this.marketParams();
    const limitOrders: LIMIT[] = [
      { price: bid.price.toString(), size: bid.size.toString(), isBuy: true, postOnly: true },
      { price: ask.price.toString(), size: ask.size.toString(), isBuy: false, postOnly: true },
    ];
    const batch: BATCH = { limitOrders, cancelOrders: this.openOrderIds, postOnly: true };
    const receipt = await KuruSdk.OrderBatcher.batchUpdate(this.signer(), this.config.marketAddress, params, batch);
    this.openOrderIds = this.parseOrderIds(receipt);
  }

  /** Cancel every order we currently track as resting on this market. */
  async cancelAllOrders(): Promise<void> {
    if (this.openOrderIds.length === 0) return;
    await KuruSdk.OrderCanceler.cancelOrders(this.signer(), this.config.marketAddress, this.openOrderIds);
    this.openOrderIds = [];
  }

  async getFills(): Promise<Fill[]> {
    return [...this.fillBuffer];
  }

  onFill(callback: (fill: Fill) => void): void {
    this.fillListeners.add(callback);
  }

  // --- internals ---

  private async marketParams(): Promise<MarketParams> {
    if (this.params) return this.params;
    this.params = await KuruSdk.ParamFetcher.getMarketParams(this.provider, this.config.marketAddress);
    return this.params;
  }

  /** Recover uint40 order IDs owned by us from a placement/batch receipt. */
  private parseOrderIds(receipt: { logs: Array<{ topics: Array<string>; data: string }> }): ethersV5.BigNumber[] {
    const iface = new ethersV5.utils.Interface(ORDERBOOK_EVENTS_ABI);
    const owner = this.signer().address.toLowerCase();
    const ids: ethersV5.BigNumber[] = [];
    for (const log of receipt.logs ?? []) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed.name === 'OrderCreated' && String(parsed.args.owner).toLowerCase() === owner) {
          ids.push(ethersV5.BigNumber.from(parsed.args.orderId));
        }
      } catch {
        // not one of our events — skip
      }
    }
    return ids;
  }

  /** Attach a Trade-event listener that emits normalized fills for our orders. */
  private subscribeFills(maker: string): void {
    try {
      const market = new ethersV5.Contract(this.config.marketAddress, ORDERBOOK_EVENTS_ABI, this.provider);
      const makerLc = maker.toLowerCase();
      market.on(
        'Trade',
        (
          _orderId: ethersV5.BigNumber,
          makerAddress: string,
          isBuy: boolean,
          price: ethersV5.BigNumber,
          _updatedSize: ethersV5.BigNumber,
          _taker: string,
          _txOrigin: string,
          filledSize: ethersV5.BigNumber,
        ) => {
          if (makerAddress.toLowerCase() !== makerLc) return; // only our fills
          this.emitFill(isBuy, price, filledSize);
        },
      );
      this.market = market;
    } catch (err) {
      this.log(`fill subscription unavailable (${err instanceof Error ? err.message : String(err)}) — PnL will lag`);
    }
  }

  /** Convert a raw Trade into a venue Fill and fan it out to listeners. */
  private emitFill(takerIsBuy: boolean, priceRaw: ethersV5.BigNumber, sizeRaw: ethersV5.BigNumber): void {
    if (!this.params) return;
    const price = Number(priceRaw.toString()) / Number(this.params.pricePrecision.toString());
    const size = Number(sizeRaw.toString()) / Number(this.params.sizePrecision.toString());
    // Maker perspective: a taker buy lifts our ask; a taker sell hits our bid.
    const side: 'bid' | 'ask' = takerIsBuy ? 'ask' : 'bid';
    const fee = (price * size * Number(this.params.makerFeeBps.toString())) / 10_000;
    const fill: Fill = { side, price, size, fee, timestamp: Date.now() };
    this.fillBuffer.push(fill);
    for (const cb of this.fillListeners) cb(fill);
  }

  private log(message: string): void {
    console.log(`[${new Date().toISOString()}] [KuruAdapter] ${message}`);
  }
}





