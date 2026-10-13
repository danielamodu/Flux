// perpl.ts — Perpl perps venue as a VenueAdapter.
//
// The working PerplClient (Ed25519 signing, WS book/fills, REST orders) lives in
// ../perpl.ts and is battle-tested; this module wraps it in the common
// VenueAdapter shape and re-exports it so both `./perpl.js` and
// `./venues/perpl.js` resolve PerplClient (backwards compat).
import { PerplClient, type Fill as PerplFill, type PerplConfig } from '../perpl.js';
import type { Order, Fill, VenueAdapter } from './types.js';

// Backwards-compat re-exports: existing imports can keep using the venues path.
export { PerplClient } from '../perpl.js';
export type { PerplConfig, Fill as PerplFill } from '../perpl.js';

/** Normalize a rich Perpl fill down to the venue-neutral Fill shape. */
function toVenueFill(f: PerplFill): Fill {
  return { side: f.side, price: f.price, size: f.size, fee: f.fee, timestamp: f.timestamp };
}

export class PerplAdapter implements VenueAdapter {
  readonly name = 'perpl';
  readonly pair: string;
  private readonly client: PerplClient;

  constructor(config: PerplConfig) {
    this.client = new PerplClient(config);
    this.pair = config.marketId === undefined || config.marketId === 16 ? 'BTC/USDC' : `PERPL-${config.marketId}/USDC`;
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  close(): void {
    this.client.close();
  }

  getMidPrice(): Promise<number> {
    return this.client.getMidPrice();
  }

  /** Rest a symmetric two-sided quote: one post-only limit per side. */
  async placeOrders(bid: Order, ask: Order): Promise<void> {
    await this.client.placeLimitOrder('bid', bid.price, bid.size);
    await this.client.placeLimitOrder('ask', ask.price, ask.size);
  }

  cancelAllOrders(): Promise<void> {
    return this.client.cancelAllOrders();
  }

  async getFills(): Promise<Fill[]> {
    return (await this.client.getFills()).map(toVenueFill);
  }

  onFill(callback: (fill: Fill) => void): void {
    this.client.fills$.subscribe((f) => callback(toVenueFill(f)));
  }
}
