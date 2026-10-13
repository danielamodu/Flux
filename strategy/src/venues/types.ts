// types.ts — the common venue interface.
//
// Every trading venue (Perpl perps, Kuru CLOB, Clober CLOB, …) is reduced to
// this one shape so the strategy engine treats "many exchanges" as a list of
// adapters rather than hard-coded clients. Prices and sizes are human-readable
// floats at this boundary; each adapter scales to its own on-chain/API units.

/** A quote to rest on one side of the book. */
export interface Order {
  side: 'bid' | 'ask';
  price: number;
  size: number;
}

/** A realized trade fill, normalized across venues. */
export interface Fill {
  side: 'bid' | 'ask';
  price: number;
  size: number;
  fee: number;
  timestamp: number;
}

/** Uniform lifecycle + trading surface implemented by every venue. */
export interface VenueAdapter {
  readonly name: string;
  /** Canonical BASE/QUOTE pair; the engine refuses to cross-quote unlike assets. */
  readonly pair: string;
  connect(): Promise<void>;
  close(): void;
  getMidPrice(): Promise<number>;
  placeOrders(bid: Order, ask: Order): Promise<void>;
  cancelAllOrders(): Promise<void>;
  /** Optionally unwind venue-held inventory back to the vault during shutdown. */
  unwind?(): Promise<void>;
  getFills(): Promise<Fill[]>;
  onFill(callback: (fill: Fill) => void): void;
  /** Optional venue minimum in human-readable base-token units. */
  getMinimumOrderSize?(): Promise<number>;
  /** Optional live base inventory in human-readable base-token units. */
  getBaseInventory?(): Promise<number>;
}
