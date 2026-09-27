// strategy.ts — passive market-making loop across a list of venues.
//
// Each cycle: read the mid on the reference venue, gate on how far it moved,
// cancel resting orders on every connected venue, check the inventory-skew
// guard, rest a symmetric bid/ask on every connected venue, then report
// realized PnL back to the FluxVault. Venues are plain VenueAdapters, so
// "many exchanges" is a list you pass in — not code you change here.
import type { Fill, Order, VenueAdapter } from './venues/index.js';
import { VaultClient } from './vault.js';

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface MarketMakerConfig {
  cycleIntervalMs?: number;
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
  /** Minimum notional per order (USD); Perpl silently drops sub-minimum rests. */
  readonly MIN_ORDER_NOTIONAL_USD = 15;
  /** Skip the cancel/requote cycle unless the mid moved at least this fraction. */
  readonly REQUOTE_MOVE_THRESHOLD = 0.001;

  private readonly cycleIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private inventoryBase = 0; // net base-asset position accumulated from fills
  private realizedPnlUsd = 0; // cumulative realized PnL in USDC terms
  private lastReportedPnlUsd = 0; // realized PnL already written to the vault
  private reportPnlInFlight = false; // serializes NAV writes (fill vs cycle)
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
  }

  /**
   * Connect every venue, skipping any that fail (logged), and start quoting.
   * Throws if no venue connects — there is nothing to make a market on. Fills
   * from all connected venues feed one shared inventory + realized-PnL book.
   */
  async start(): Promise<void> {
    if (this.running) return;
    const connected: VenueAdapter[] = [];
    for (const venue of this.venues) {
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
    this.connected = connected;
    this.running = true;
    this.state = VaultState.DEPLOYED;
    this.log(`starting (state=DEPLOYED, venues=[${connected.map((v) => v.name).join(', ')}])`);
    this.timer = setInterval(() => {
      void this.cycle();
    }, this.cycleIntervalMs);
  }

  /** Cancel every resting order on every venue and mark capital withdrawable. */
  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.running = false;
    this.state = VaultState.UNWINDING;
    this.log('unwinding — cancelling all resting orders');
    try {
      await Promise.all(this.connected.map((v) => v.cancelAllOrders()));
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

  /** Fold a fill into shared inventory + realized PnL, then push NAV to the vault. */
  private onFill(fill: Fill): void {
    this.inventoryBase += fill.side === 'bid' ? fill.size : -fill.size;
    this.realizedPnlUsd += (fill.side === 'ask' ? 1 : -1) * fill.price * fill.size - fill.fee;
    this.log(`fill ${fill.side} ${fill.size} @ ${fill.price} (inventory=${this.inventoryBase.toFixed(6)})`);
    void this.reportPnl().catch((err) => this.log(`reportPnl (on fill) failed: ${errMsg(err)}`));
  }

  private quote(mid: number): { bid: number; ask: number } {
    return { bid: mid * (1 - this.SPREAD), ask: mid * (1 + this.SPREAD) };
  }

  /** One market-making cycle across all connected venues. */
  private async cycle(): Promise<void> {
    try {
      // a. reference mid from the primary (first connected) venue — Perpl in prod.
      const mid = await this.connected[0].getMidPrice();
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

      // c. inventory-skew guard.
      const skew = await this.inventorySkew(mid);
      if (skew > this.MAX_INVENTORY_SKEW) {
        this.log(`WARNING: inventory skew ${(skew * 100).toFixed(1)}% > max — skipping placement`);
        this.lastQuotedMid = 0;
        return;
      }

      // c'. bail if we've begun unwinding since this cycle started.
      if (this.state !== VaultState.DEPLOYED) return;

      // d. rest a symmetric quote on every connected venue.
      const size = await this.orderSize(mid);
      const { bid, ask } = this.quote(mid);
      const bidOrder: Order = { side: 'bid', price: bid, size };
      const askOrder: Order = { side: 'ask', price: ask, size };
      await Promise.all(this.connected.map((v) => v.placeOrders(bidOrder, askOrder)));
      this.lastQuotedMid = mid;
      this.log(`quoted size=${size.toFixed(6)} bid=${bid.toFixed(2)} ask=${ask.toFixed(2)} on [${this.connected.map((v) => v.name).join(', ')}]`);
      // e. report PnL to the vault.
      await this.reportPnl();
    } catch (err) {
      this.log(`cycle error: ${errMsg(err)}`);
    }
  }

  /** |inventory notional| as a fraction of deployed capital (0 if none deployed). */
  private async inventorySkew(mid: number): Promise<number> {
    const deployedUsd = Number(await this.vault.getAvailableLiquidity()) / 1e6;
    if (deployedUsd <= 0) return 0;
    return Math.abs(this.inventoryBase * mid) / deployedUsd;
  }

  /** Per-order base size: 1% of deployed capital, floored at the venue minimum. */
  private async orderSize(mid: number): Promise<number> {
    const deployedUsd = Number(await this.vault.getAvailableLiquidity()) / 1e6;
    const notionalUsd = Math.max(deployedUsd * 0.01, this.MIN_ORDER_NOTIONAL_USD);
    return mid > 0 ? notionalUsd / mid : 0;
  }

  /**
   * Write realized PnL to the vault as an absolute NAV. Serialized via
   * reportPnlInFlight so a fill and a cycle can't race two updateTotalAssets
   * calls off the same on-chain read. Clamped at 0 — NAV never goes negative.
   */
  private async reportPnl(): Promise<void> {
    if (this.reportPnlInFlight) {
      this.log('reportPnl skipped (in flight)');
      return;
    }
    this.reportPnlInFlight = true;
    try {
      const currentOnChain = await this.vault.getTotalAssets();
      const deltaUsd = this.realizedPnlUsd - this.lastReportedPnlUsd;
      const deltaUnits = BigInt(Math.round(deltaUsd * 1e6));
      const newTotal = currentOnChain + deltaUnits;
      const clamped = newTotal < 0n ? 0n : newTotal;
      await this.vault.updateTotalAssets(clamped);
      this.lastReportedPnlUsd = this.realizedPnlUsd;
      this.log(`reported totalAssets=${clamped.toString()} (delta ${deltaUsd.toFixed(6)} USDC)`);
    } finally {
      this.reportPnlInFlight = false;
    }
  }

  private log(message: string): void {
    console.log(`[${new Date().toISOString()}] [MarketMaker] ${message}`);
  }
}
