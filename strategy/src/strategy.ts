// strategy.ts — passive market-making loop across Perpl and Kuru.
//
// Each cycle: read mids on both venues, cancel resting orders, check the
// inventory-skew guard, quote a symmetric bid/ask around each mid, then report
// realized PnL back to the FluxVault. Compile/dry-run oriented; real order
// placement happens only when the venue clients are pointed at live testnet
// endpoints with funded keys.
import { PerplClient, type Fill } from './perpl.js';
import { KuruClient } from './kuru.js';
import { VaultClient } from './vault.js';

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface MarketMakerConfig {
  kuruMarketAddress: string;
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
  /**
   * Minimum notional per order. Perpl silently declines to rest sub-minimum orders
   * (the POST returns a forwarding ack but nothing ever lands on the book) — observed
   * ~$10 via the order's `mnp` field; $8 was dropped, $42 rested. $15 clears it.
   */
  readonly MIN_ORDER_NOTIONAL_USD = 15;
  /** Skip the cancel/requote cycle unless the mid has moved at least this fraction (0.1%). */
  readonly REQUOTE_MOVE_THRESHOLD = 0.001;

  private readonly cycleIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private inventoryBase = 0; // net base-asset position accumulated from fills
  private realizedPnlUsd = 0; // cumulative realized PnL in USDC terms
  private lastReportedPnlUsd = 0; // realized PnL already written to the vault (drives delta NAV writes)
  private readonly kuruEnabled: boolean; // false when KURU_MARKET_ADDRESS is unset (Perpl-only)
  private lastQuotedMid = 0; // Perpl mid at which resting orders were last placed (0 = none live)
  private state: VaultState = VaultState.AVAILABLE; // capital lifecycle; gates withdrawal

  constructor(
    private readonly perpl: PerplClient,
    private readonly kuru: KuruClient,
    private readonly vault: VaultClient,
    private readonly config: MarketMakerConfig,
  ) {
    this.cycleIntervalMs = config.cycleIntervalMs ?? 8000;
    this.kuruEnabled = (config.kuruMarketAddress ?? '').trim().length > 0;
    // Track fills as they stream in to maintain inventory + realized PnL.
    this.perpl.fills$.subscribe((fill) => this.onFill(fill));
  }
  start(): void {
    if (this.running) return;
    this.running = true;
    this.state = VaultState.DEPLOYED;
    this.log('starting market maker (state=DEPLOYED)');
    this.timer = setInterval(() => {
      void this.cycle();
    }, this.cycleIntervalMs);
  }

  /**
   * Stop quoting and unwind: cancel every resting order before declaring the vault
   * AVAILABLE, so a withdrawal can never race live orders. Resolves only once the book
   * is clear. If cancellation fails, state stays UNWINDING and the error rethrows
   * (withdrawal remains blocked) rather than falsely reporting AVAILABLE.
   */
  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.running = false;
    this.state = VaultState.UNWINDING;
    this.log('unwinding — cancelling all resting orders');
    const cancels: Promise<void>[] = [this.perpl.cancelAllOrders()];
    if (this.kuruEnabled) cancels.push(this.kuru.cancelAllOrders(this.config.kuruMarketAddress));
    try {
      await Promise.all(cancels);
    } catch (err) {
      this.log(`unwind failed — staying UNWINDING (withdrawal blocked): ${errMsg(err)}`);
      throw err;
    }
    this.lastQuotedMid = 0;
    this.state = VaultState.AVAILABLE;
    this.log('stopped market maker (state=AVAILABLE)');
  }

  /** True only when capital is fully unwound (no live orders) and safe to withdraw. */
  isReadyForWithdrawal(): boolean {
    return this.state === VaultState.AVAILABLE;
  }

  private onFill(fill: Fill): void {
    // Buys add to inventory, sells reduce it; realized PnL accrues on notional.
    this.inventoryBase += fill.side === 'bid' ? fill.size : -fill.size;
    this.realizedPnlUsd += (fill.side === 'ask' ? 1 : -1) * fill.price * fill.size - fill.fee;
    this.log(`fill ${fill.side} ${fill.size} @ ${fill.price} (inventory=${this.inventoryBase.toFixed(6)})`);
  }

  private quote(mid: number): { bid: number; ask: number } {
    return { bid: mid * (1 - this.SPREAD), ask: mid * (1 + this.SPREAD) };
  }
  private async cycle(): Promise<void> {
    try {
      // a. mid prices — Kuru only when a market address is configured
      const perplMid = await this.perpl.getMidPrice();
      const kuruMid = this.kuruEnabled ? await this.kuru.getMidPrice(this.config.kuruMarketAddress) : undefined;
      this.log(`mids — perpl=${perplMid}${kuruMid !== undefined ? ` kuru=${kuruMid}` : ' (kuru disabled)'}`);

      // a'. requote gate — hold resting orders unless the Perpl mid has moved enough.
      if (this.lastQuotedMid > 0) {
        const move = Math.abs(perplMid - this.lastQuotedMid) / this.lastQuotedMid;
        if (move <= this.REQUOTE_MOVE_THRESHOLD) {
          this.log(
            `mid moved ${(move * 100).toFixed(3)}% (<= ${(this.REQUOTE_MOVE_THRESHOLD * 100).toFixed(1)}%) ` +
              `— holding resting orders`,
          );
          return;
        }
      }

      // b. clear resting orders before requoting (both venues when Kuru is on)
      const cancels: Promise<void>[] = [this.perpl.cancelAllOrders()];
      if (this.kuruEnabled) cancels.push(this.kuru.cancelAllOrders(this.config.kuruMarketAddress));
      await Promise.all(cancels);

      // c. inventory-skew guard
      const skew = await this.inventorySkew(perplMid);
      if (skew > this.MAX_INVENTORY_SKEW) {
        this.log(
          `WARNING: inventory skew ${(skew * 100).toFixed(1)}% exceeds max ` +
            `${(this.MAX_INVENTORY_SKEW * 100).toFixed(0)}% — skipping order placement`,
        );
        this.lastQuotedMid = 0; // orders were cancelled and not replaced — hold nothing
        return;
      }

      // c'. bail if we've begun unwinding since this cycle started — never place mid-stop.
      if (this.state !== VaultState.DEPLOYED) return;

      // d. place bid + ask on Perpl, and on Kuru when enabled
      const size = await this.orderSize(perplMid);
      const perplQuote = this.quote(perplMid);
      const orders: Promise<void>[] = [
        this.perpl.placeLimitOrder('bid', perplQuote.bid, size),
        this.perpl.placeLimitOrder('ask', perplQuote.ask, size),
      ];
      let venues = `perpl[${perplQuote.bid.toFixed(2)}/${perplQuote.ask.toFixed(2)}]`;
      if (this.kuruEnabled && kuruMid !== undefined) {
        const kuruQuote = this.quote(kuruMid);
        orders.push(this.kuru.placeLimitOrder(this.config.kuruMarketAddress, 'bid', kuruQuote.bid, size));
        orders.push(this.kuru.placeLimitOrder(this.config.kuruMarketAddress, 'ask', kuruQuote.ask, size));
        venues += ` kuru[${kuruQuote.bid.toFixed(2)}/${kuruQuote.ask.toFixed(2)}]`;
      }
      await Promise.all(orders);
      this.lastQuotedMid = perplMid; // anchor the requote gate to the mid we just quoted at
      this.log(`quoted size=${size.toFixed(6)} ${venues}`);

      // e. report PnL to the vault
      await this.reportPnl();
    } catch (err) {
      this.log(`cycle error: ${errMsg(err)}`);
    }
  }
  private async inventorySkew(mid: number): Promise<number> {
    const deployedUsd = Number(await this.vault.getAvailableLiquidity()) / 1e6;
    if (deployedUsd <= 0) return 0;
    return Math.abs(this.inventoryBase * mid) / deployedUsd;
  }

  private async orderSize(mid: number): Promise<number> {
    const deployedUsd = Number(await this.vault.getAvailableLiquidity()) / 1e6;
    // Quote ~1% of deployed capital per order, but never below the venue minimum.
    const notionalUsd = Math.max(deployedUsd * 0.01, this.MIN_ORDER_NOTIONAL_USD);
    return mid > 0 ? notionalUsd / mid : 0;
  }

  private async reportPnl(): Promise<void> {
    // Read the live on-chain NAV fresh, then apply only the realized PnL accrued since the
    // last write, as a delta. Reading fresh each cycle means deposits/withdrawals that moved
    // totalAssets between writes are respected — we never overwrite from a frozen baseline,
    // so a withdrawal can't be re-inflated away on the next write.
    const currentOnChain = await this.vault.getTotalAssets();
    const deltaUsd = this.realizedPnlUsd - this.lastReportedPnlUsd;
    const deltaUnits = BigInt(Math.round(deltaUsd * 1e6));
    const newTotal = currentOnChain + deltaUnits;
    const clamped = newTotal < 0n ? 0n : newTotal;
    await this.vault.updateTotalAssets(clamped);
    this.lastReportedPnlUsd = this.realizedPnlUsd;
    this.log(
      `reported totalAssets=${clamped.toString()} ` +
        `(on-chain ${currentOnChain.toString()} + PnL delta ${deltaUsd.toFixed(6)} USDC)`,
    );
  }

  private log(message: string): void {
    console.log(`[${new Date().toISOString()}] [MarketMaker] ${message}`);
  }
}
