// strategy.ts — passive market-making loop across a list of venues.
//
// Each cycle: read the mid on the reference venue, gate on how far it moved,
// cancel resting orders on every connected venue, check the inventory-skew
// guard, and rest a symmetric bid/ask on every connected venue. Venue balances
// are not controlled or valued by FluxVault and are never reported as vault NAV.
// Venues are plain VenueAdapters, so
// "many exchanges" is a list you pass in — not code you change here.
import type { Fill, Order, VenueAdapter } from './venues/index.js';
import { VaultClient } from './vault.js';

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : JSON.stringify(e);
}

export interface MarketMakerConfig {
  cycleIntervalMs?: number;
  /** Sell venue inventory and return it to the vault when stop() is called. */
  unwindOnStop?: boolean;
}

/** Lifecycle of the vault's deployed capital. Withdrawals are only safe in AVAILABLE. */
export enum VaultState {
  AVAILABLE,
  DEPLOYED,
  UNWINDING,
}

export class MarketMaker {
  /** Half-spread applied around the mid on each side (0.05%). */
  readonly SPREAD = 0.0005;
  /** Max |inventory| as a fraction of deployed capital before we stop quoting. */
  readonly MAX_INVENTORY_SKEW = 0.3;
  /** Minimum notional per order (USD); Kuru rejects sizes below its market minimum. */
  readonly MIN_ORDER_NOTIONAL_USD = 15;
  /** At the current $1,000 strategy cap this yields the $15 minimum order. */
  readonly ORDER_NOTIONAL_FRACTION = 0.015;
  /** Skip the cancel/requote cycle unless the mid moved at least this fraction. */
  readonly REQUOTE_MOVE_THRESHOLD = 0.001;

  private readonly cycleIntervalMs: number;
  private readonly unwindOnStop: boolean;
  private timer: ReturnType<typeof setInterval> | undefined;
  private cycleInFlight: Promise<void> | undefined;
  private running = false;
  private inventoryBase = 0; // net base-asset position accumulated from fills
  private lastQuotedMid = 0; // mid at which resting orders were last placed
  private state: VaultState = VaultState.AVAILABLE; // gates withdrawal
  /** Venues that connected successfully; the first is the reference (mid) venue. */
  private connected: VenueAdapter[] = [];

  constructor(
    private readonly venues: VenueAdapter[],
    private readonly vault: VaultClient,
    config: MarketMakerConfig = {},
  ) {
    this.cycleIntervalMs = config.cycleIntervalMs ?? 8000;
    this.unwindOnStop = config.unwindOnStop ?? false;
  }

  /**
   * Connect every venue, skipping any that fail (logged), and start quoting.
   * Throws if no venue connects — there is nothing to make a market on. Fills
   * from all connected venues feed one shared inventory + realized-PnL book.
   */
  async start(): Promise<void> {
    if (this.running) return;
    const reference = this.venues[0];
    if (!reference) throw new Error('no venues configured — cannot start market maker');
    const compatible = this.venues.filter((venue) => venue.pair === reference.pair);
    if (compatible.length !== this.venues.length) {
      const incompatible = this.venues
        .filter((venue) => venue.pair !== reference.pair)
        .map((venue) => `${venue.name} (${venue.pair})`);
      throw new Error(
        `venue pair mismatch: reference ${reference.pair}; incompatible: ${incompatible.join(', ')}`,
      );
    }
    const connected: VenueAdapter[] = [];
    for (const venue of compatible) {
      try {
        await venue.connect();
        venue.onFill((fill) => this.onFill(fill));
        connected.push(venue);
        this.log(`connected venue: ${venue.name}`);
      } catch (err) {
        this.log(`venue ${venue.name} failed to connect — skipping: ${errMsg(err)}`);
      }
    }
    if (connected.length === 0) throw new Error('no venues connected — cannot start market maker');
    const referenceMid = await connected[0].getMidPrice();
    if (!Number.isFinite(referenceMid) || referenceMid <= 0) {
      await Promise.allSettled(connected.map((venue) => venue.cancelAllOrders()));
      throw new Error(`reference venue returned invalid or stale price: ${referenceMid}`);
    }
    this.connected = connected;
    this.running = true;
    this.state = VaultState.DEPLOYED;
    this.log(`starting (state=DEPLOYED, venues=[${connected.map((v) => v.name).join(', ')}])`);
    this.timer = setInterval(() => this.runCycleOnce(), this.cycleIntervalMs);
  }

  /** Prevent overlapping cycles from placing stale duplicate order sets. */
  private runCycleOnce(): void {
    if (!this.running || this.cycleInFlight) return;
    this.cycleInFlight = this.cycle().finally(() => {
      this.cycleInFlight = undefined;
    });
  }

  /** Cancel every resting order and, when configured, return venue inventory. */
  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.running = false;
    this.state = VaultState.UNWINDING;
    this.log('unwinding — cancelling all resting orders');
    try {
      // Wait for a placement already in progress, then cancel its resulting orders.
      await this.cycleInFlight;
      await Promise.all(this.connected.map((v) => v.cancelAllOrders()));
      if (this.unwindOnStop) {
        const unsupported = this.connected.filter((venue) => !venue.unwind);
        if (unsupported.length !== 0) {
          throw new Error(`shutdown unwind unsupported by: ${unsupported.map((venue) => venue.name).join(', ')}`);
        }
        await Promise.all(this.connected.map((venue) => venue.unwind!()));
      }
    } catch (err) {
      this.log(`unwind failed — staying UNWINDING (withdrawal blocked): ${errMsg(err)}`);
      throw err;
    }
    this.lastQuotedMid = 0;
    this.state = VaultState.AVAILABLE;
    this.log('stopped (state=AVAILABLE)');
  }

  /** Withdrawals are only safe once we've fully unwound (no resting orders). */
  isReadyForWithdrawal(): boolean {
    return this.state === VaultState.AVAILABLE;
  }

  /** Fold a fill into the bot's operational inventory view only. */
  private onFill(fill: Fill): void {
    this.inventoryBase += fill.side === 'bid' ? fill.size : -fill.size;
    this.log(`fill ${fill.side} ${fill.size} @ ${fill.price} (inventory=${this.inventoryBase.toFixed(6)})`);
  }

  private quote(mid: number): { bid: number; ask: number } {
    return { bid: mid * (1 - this.SPREAD), ask: mid * (1 + this.SPREAD) };
  }

  /** One market-making cycle across all connected venues. */
  private async cycle(): Promise<void> {
    try {
      if (this.state !== VaultState.DEPLOYED) return;
      // a. reference mid from the primary (first connected) venue — Perpl in prod.
      const mid = await this.connected[0].getMidPrice();
      if (!Number.isFinite(mid) || mid <= 0) throw new Error(`invalid reference mid price: ${mid}`);
      this.log(`mid (${this.connected[0].name})=${mid}`);

      // a'. requote gate — hold resting orders unless the mid moved enough.
      if (this.lastQuotedMid > 0) {
        const move = Math.abs(mid - this.lastQuotedMid) / this.lastQuotedMid;
        if (move <= this.REQUOTE_MOVE_THRESHOLD) {
          this.log(`mid moved ${(move * 100).toFixed(3)}% (<= threshold) — holding resting orders`);
          return;
        }
      }

      // b. clear resting orders on every venue before requoting.
      await Promise.all(this.connected.map((v) => v.cancelAllOrders()));

      if (this.state !== VaultState.DEPLOYED) return;

      // c. inventory-skew guard.
      const skew = await this.inventorySkew(mid);
      if (skew > this.MAX_INVENTORY_SKEW) {
        this.log(`WARNING: inventory skew ${(skew * 100).toFixed(1)}% > max — skipping placement`);
        this.lastQuotedMid = 0;
        return;
      }

      // c'. bail if we've begun unwinding since this cycle started.
      if (!this.running || this.state !== VaultState.DEPLOYED) return;

      // d. rest a symmetric quote on every connected venue.
      const size = await this.orderSize(mid);
      if (size <= 0) {
        this.log('vault NAV is below the minimum order threshold; no orders placed');
        this.lastQuotedMid = 0;
        return;
      }
      const { bid, ask } = this.quote(mid);
      const bidOrder: Order = { side: 'bid', price: bid, size };
      const askOrder: Order = { side: 'ask', price: ask, size };
      await Promise.all(this.connected.map((v) => v.placeOrders(bidOrder, askOrder)));
      this.lastQuotedMid = mid;
      this.log(`quoted size=${size.toFixed(6)} bid=${bid.toFixed(2)} ask=${ask.toFixed(2)} on [${this.connected.map((v) => v.name).join(', ')}]`);
    } catch (err) {
      this.log(`cycle error: ${errMsg(err)}`);
      try {
        await Promise.all(this.connected.map((venue) => venue.cancelAllOrders()));
        this.lastQuotedMid = 0;
      } catch (cancelErr) {
        this.log(`fail-safe cancellation failed: ${errMsg(cancelErr)}`);
        this.running = false;
        this.state = VaultState.UNWINDING;
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
      }
    }
  }

  /** |inventory notional| as a fraction of deployed capital (0 if none deployed). */
  private async inventorySkew(mid: number): Promise<number> {
    const deployedUsd = Number(await this.vault.getTotalAssets()) / 1e6;
    if (deployedUsd <= 0) return 0;
    const inventory = this.connected.length === 1 && this.connected[0].getBaseInventory
      ? await this.connected[0].getBaseInventory()
      : this.inventoryBase;
    return Math.abs(inventory * mid) / deployedUsd;
  }

  /** Per-order base size from NAV; skip if the configured share is below the venue minimum. */
  private async orderSize(mid: number): Promise<number> {
    const deployedUsd = Number(await this.vault.getTotalAssets()) / 1e6;
    const notionalUsd = deployedUsd * this.ORDER_NOTIONAL_FRACTION;
    if (notionalUsd < this.MIN_ORDER_NOTIONAL_USD) return 0;
    return mid > 0 ? notionalUsd / mid : 0;
  }

  private log(message: string): void {
    console.log(`[${new Date().toISOString()}] [MarketMaker] ${message}`);
  }
}
