// perpl.ts — Perpl perps venue client (testnet only).
//
// Handles Ed25519 request signing, a WebSocket order-book/fills feed, and the
// REST endpoints the strategy needs. Every endpoint comes from config (.env);
// nothing here hard-codes mainnet.
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import WebSocket from 'ws';

/** A single trade fill reported by Perpl (mt:25 stream or REST). */
export interface Fill {
  id: string;
  marketId: number;
  side: 'bid' | 'ask';
  price: number;
  size: number;
  fee: number;
  timestamp: number;
}

export interface PerplConfig {
  apiUrl: string;
  wsUrl: string;
  chainId: number | string;
  apiKey: string;
  /** Ed25519 secret-key seed, hex encoded (with or without 0x). */
  apiSecret: string;
  /** Monad RPC, used to read the head block for order TTLs (lb). */
  rpcUrl: string;
  /** Exchange account id (uint64). If omitted, the first account on the wallet is used. */
  accountId?: number;
  /** Position leverage in hundredths (100 = 1x). Defaults to 100. */
  leverage?: number;
  /** Market to quote; defaults to 16 (BTC on testnet). */
  marketId?: number;
}

/** Minimal push-stream so callers can react to fills without an extra dep. */
export class Observable<T> {
  private readonly listeners = new Set<(value: T) => void>();
  subscribe(fn: (value: T) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  emit(value: T): void {
    for (const fn of this.listeners) fn(value);
  }
}

function stripHexPrefix(hex: string): string {
  return hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
}
export class PerplClient {
  /** Fires on every mt:25 fill event. */
  readonly fills$ = new Observable<Fill>();

  private readonly config: PerplConfig;
  private readonly marketId: number;
  private readonly secretKey: Uint8Array;
  private wsTrading: WebSocket | undefined;
  private wsMarket: WebSocket | undefined;
  private bids = new Map<number, number>(); // scaled price -> scaled size (live L2 book)
  private asks = new Map<number, number>();
  private orderFills = new Map<number, { fs: number; fee: number }>(); // oid -> last-seen cumulative fill
  private accountId: number | undefined; // resolved from GET /v1/trading/wallet
  private rqCounter: number | undefined; // seeded from Account.lfr, then incremented locally
  private marketMeta: { priceDecimals: number; sizeDecimals: number; ttlBlocks: number } | undefined;

  constructor(config: PerplConfig) {
    this.config = config;
    this.marketId = config.marketId ?? 16;
    const secretHex = stripHexPrefix(config.apiSecret ?? '');
    // Empty secret is tolerated at construction (compile/dry-run only); signing
    // then yields a signature the server rejects until a real key is provided.
    this.secretKey = secretHex.length > 0 ? ed.etc.hexToBytes(secretHex) : new Uint8Array(32);
  }

  /** Build the canonical string and Ed25519-sign it (RFC8032 async API). */
  private async sign(
    method: string,
    target: string,
    body: string,
  ): Promise<{ timestamp: string; nonce: string; signature: string; bodyHash: string }> {
    const timestamp = Date.now().toString();
    const nonce = randomBytes(16).toString('base64url');
    const bodyHash = createHash('sha256').update(body).digest('hex');
    // Canonical string per Perpl api-docs/authentication.md: six \n-joined fields.
    // `target` is the request path + query, starting at /v1 (the base URL holds /api).
    const canonical = [String(this.config.chainId), method, target, timestamp, nonce, bodyHash].join('\n');
    const message = new TextEncoder().encode(canonical);
    const sig = await ed.signAsync(message, this.secretKey);
    return { timestamp, nonce, signature: Buffer.from(sig).toString('base64url'), bodyHash };
  }

  private async signedRequest(method: string, path: string, body?: unknown): Promise<Response> {
    const bodyStr = body === undefined ? '' : JSON.stringify(body);
    const { timestamp, nonce, signature } = await this.sign(method, path, bodyStr);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-API-Key': this.config.apiKey,
      'X-API-Timestamp': timestamp,
      'X-API-Nonce': nonce,
      'X-API-Signature': signature,
    };
    return fetch(`${this.config.apiUrl}${path}`, {
      method,
      headers,
      body: method === 'GET' ? undefined : bodyStr,
    });
  }
  /** Open both Perpl sockets: trading (sign-in → order/fill updates) + market-data (book). */
  async connect(): Promise<void> {
    await this.getMarketMeta(); // preload decimals so fills/book unscale correctly
    await Promise.all([this.connectTrading(), this.connectMarketData()]);
  }

  /** Trading socket: ApiKeySignIn (mt:29). Our fills surface as order updates (mt:24). */
  private async connectTrading(): Promise<void> {
    const { timestamp, nonce, signature } = await this.signWsSignIn();
    const ws = new WebSocket(`${this.config.wsUrl}/ws/v1/trading`);
    this.wsTrading = ws;
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => {
        ws.send(
          JSON.stringify({
            mt: 29,
            chain_id: Number(this.config.chainId),
            api_key: this.config.apiKey,
            timestamp,
            nonce,
            signature,
          }),
        );
        console.log(`[${new Date().toISOString()}] [PerplClient] trading WS connected`);
        resolve();
      });
      ws.on('error', (err: Error) => reject(err));
    });
    ws.on('message', (data: WebSocket.RawData) => this.handleMessage(data));
  }
  /** Market-data socket (no auth): subscribe to the L2 order book for a live mid. */
  private async connectMarketData(): Promise<void> {
    const ws = new WebSocket(`${this.config.wsUrl}/ws/v1/market-data`);
    this.wsMarket = ws;
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ mt: 5, subs: [{ stream: `order-book@${this.marketId}`, subscribe: true }] }));
        console.log(`[${new Date().toISOString()}] [PerplClient] market-data WS connected`);
        resolve();
      });
      ws.on('error', (err: Error) => reject(err));
    });
    ws.on('message', (data: WebSocket.RawData) => this.handleMessage(data));
  }

  /** Sign the WS canonical: chainId \n "trading-ws-signin" \n timestamp \n nonce (4 fields). */
  private async signWsSignIn(): Promise<{ timestamp: string; nonce: string; signature: string }> {
    const timestamp = Date.now().toString();
    const nonce = randomBytes(16).toString('base64url');
    const canonical = [String(this.config.chainId), 'trading-ws-signin', timestamp, nonce].join('\n');
    const sig = await ed.signAsync(new TextEncoder().encode(canonical), this.secretKey);
    return { timestamp, nonce, signature: Buffer.from(sig).toString('base64url') };
  }

  private handleMessage(data: WebSocket.RawData): void {
    let msg: Record<string, any>;
    try {
      msg = JSON.parse(data.toString()) as Record<string, any>;
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    switch (Number(msg.mt)) {
      case 15: // L2 book snapshot (replaces the book)
      case 16: // L2 book delta (a level with o:0 is a removal)
        this.applyOrderBook(msg);
        break;
      case 23: // orders snapshot — seed fill tracking, don't emit historical fills
        for (const o of msg.d ?? []) this.seedOrder(o);
        break;
      case 24: // order updates — our fills surface here as filled-size (fs) grows
        for (const o of msg.d ?? []) this.applyOrderUpdate(o);
        break;
    }
  }

  /** Record an order's current cumulative fill on the initial snapshot (no emit). */
  private seedOrder(o: Record<string, any>): void {
    const oid = Number(o?.oid);
    if (oid) this.orderFills.set(oid, { fs: Number(o?.fs ?? 0), fee: Number(o?.f ?? 0) });
  }
  /** Emit a Fill when an order's cumulative filled size grows; prune terminal orders. */
  private applyOrderUpdate(o: Record<string, any>): void {
    const oid = Number(o?.oid);
    if (!oid) return;
    const fs = Number(o?.fs ?? 0);
    const fee = Number(o?.f ?? 0);
    const prev = this.orderFills.get(oid) ?? { fs: 0, fee: 0 };
    if (fs > prev.fs) {
      const fill = this.toFill(o, fs - prev.fs, fee - prev.fee);
      if (fill) this.fills$.emit(fill);
    }
    // Prune fully-filled or removed orders so the map can't grow without bound.
    if (o?.r === true || (fs > 0 && fs >= Number(o?.os ?? 0))) this.orderFills.delete(oid);
    else this.orderFills.set(oid, { fs, fee });
  }

  /**
   * Build a Fill from a filled-size delta. Perpl fills carry no explicit side, so the
   * trade direction is derived from OrderType t: buy for OpenLong(1)/CloseShort(4),
   * sell for OpenShort(2)/CloseLong(3). Price/size are unscaled by market decimals.
   */
  private toFill(o: Record<string, any>, sizeScaled: number, fee: number): Fill | null {
    if (!o || typeof o !== 'object') return null;
    const pScale = 10 ** (this.marketMeta?.priceDecimals ?? 0);
    const sScale = 10 ** (this.marketMeta?.sizeDecimals ?? 0);
    const t = Number(o.t);
    const side: 'bid' | 'ask' = t === 1 || t === 4 ? 'bid' : 'ask';
    return {
      id: String(o.oid ?? o.id ?? ''),
      marketId: Number(o.mkt ?? this.marketId),
      side,
      price: Number(o.fp ?? o.p ?? 0) / pScale,
      size: sizeScaled / sScale,
      fee,
      timestamp: Number(o.at?.t ?? o.at ?? Date.now()),
    };
  }

  private applyOrderBook(msg: Record<string, any>): void {
    if (Number(msg.mt) === 15) {
      // Snapshot: the incoming levels are the whole book.
      this.bids.clear();
      this.asks.clear();
    }
    const apply = (levels: any, side: Map<number, number>): void => {
      if (!Array.isArray(levels)) return;
      for (const lvl of levels) {
        const p = Number(lvl?.p);
        if (!Number.isFinite(p)) continue;
        // o:0 (or zero size) removes the level; otherwise it's the new resting size.
        if (Number(lvl?.o ?? 1) === 0 || Number(lvl?.s ?? 0) === 0) side.delete(p);
        else side.set(p, Number(lvl?.s));
      }
    };
    apply(msg.bid, this.bids);
    apply(msg.ask, this.asks);
  }

  /** Mid price from the live WS book, falling back to the public context snapshot. */
  async getMidPrice(): Promise<number> {
    if (this.bids.size > 0 && this.asks.size > 0) {
      const scale = 10 ** (this.marketMeta?.priceDecimals ?? 0);
      const bestBid = Math.max(...this.bids.keys());
      const bestAsk = Math.min(...this.asks.keys());
      if (scale > 0) return (bestBid + bestAsk) / (2 * scale);
    }
    // Public snapshot: /api/v1/pub/context carries each market's state with mid/bid/ask
    // as fixed-point integers scaled by config.price_decimals. No auth required.
    const res = await fetch(`${this.config.apiUrl}/v1/pub/context`, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`Perpl pub/context failed: ${res.status}`);
    const data = (await res.json()) as { markets?: Record<string, any>[] };
    const market = (data.markets ?? []).find((m) => Number(m?.id) === this.marketId);
    if (!market) throw new Error(`Perpl: market ${this.marketId} not found in context`);
    const scale = 10 ** Number(market?.config?.price_decimals ?? 0);
    const mid = Number(market?.state?.mid);
    if (Number.isFinite(mid) && mid > 0) return mid / scale;
    const bid = Number(market?.state?.bid);
    const ask = Number(market?.state?.ask);
    if (Number.isFinite(bid) && Number.isFinite(ask)) return (bid + ask) / (2 * scale);
    throw new Error('Perpl: no mid price available in context');
  }

  /**
   * Resolve the exchange account (id + request-id seed) via GET /v1/trading/wallet.
   * `rq` must strictly increase per account, so it's seeded once from the account's
   * lfr (last forwarded request id) and incremented locally thereafter.
   */
  private async ensureAccount(): Promise<number> {
    if (this.accountId !== undefined && this.rqCounter !== undefined) return this.accountId;
    const res = await this.signedRequest('GET', '/v1/trading/wallet');
    if (!res.ok) throw new Error(`Perpl wallet fetch failed: ${res.status} ${await res.text()}`);
    const wallet = (await res.json()) as { as?: Record<string, any>[] };
    const accounts = wallet.as ?? [];
    const account =
      this.config.accountId !== undefined
        ? accounts.find((a) => Number(a?.id) === this.config.accountId)
        : accounts[0];
    if (!account) throw new Error(`Perpl: account ${this.config.accountId ?? '(first)'} not found on wallet`);
    this.accountId = Number(account.id);
    this.rqCounter = Number(account.lfr ?? 0);
    if (account.fw === false) {
      console.warn(`[PerplClient] account ${this.accountId} has order forwarding (fw) disabled — orders will be rejected`);
    }
    return this.accountId;
  }

  private nextRq(): number {
    this.rqCounter = (this.rqCounter ?? 0) + 1;
    return this.rqCounter;
  }

  /** Static market config (decimals + order TTL) from the public context, cached. */
  private async getMarketMeta(): Promise<{ priceDecimals: number; sizeDecimals: number; ttlBlocks: number }> {
    if (this.marketMeta) return this.marketMeta;
    const res = await fetch(`${this.config.apiUrl}/v1/pub/context`, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`Perpl pub/context failed: ${res.status}`);
    const data = (await res.json()) as { markets?: Record<string, any>[] };
    const market = (data.markets ?? []).find((m) => Number(m?.id) === this.marketId);
    if (!market) throw new Error(`Perpl: market ${this.marketId} not found in context`);
    this.marketMeta = {
      priceDecimals: Number(market?.config?.price_decimals ?? 0),
      sizeDecimals: Number(market?.config?.size_decimals ?? 0),
      ttlBlocks: Number(market?.order_ttl_blocks ?? 0),
    };
    return this.marketMeta;
  }

  /**
   * The exchange's current head block, taken from the wallet snapshot `sn`. Order `lb`
   * must satisfy head < lb <= head + order_ttl_blocks against the *exchange's* head, which
   * drifts several blocks from the raw RPC tip — so we anchor to sn, not eth_blockNumber.
   */
  private async getExchangeHead(): Promise<number> {
    const res = await this.signedRequest('GET', '/v1/trading/wallet');
    if (!res.ok) throw new Error(`Perpl wallet fetch failed: ${res.status} ${await res.text()}`);
    const wallet = (await res.json()) as { sn?: number };
    return Number(wallet.sn ?? 0);
  }
  /** POST a batch of order specs to /v1/trading/orders and surface per-order failures. */
  private async submitBatch(specs: Record<string, unknown>[]): Promise<void> {
    if (specs.length === 0) return;
    const res = await this.signedRequest('POST', '/v1/trading/orders', { d: specs });
    if (!res.ok) throw new Error(`Perpl order batch failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { status?: { code?: number }; statuses?: { code?: number; error?: string }[] };
    const failed = (body.statuses ?? []).filter((s) => s && s.code !== 0);
    if (failed.length > 0) {
      throw new Error(`Perpl order batch rejected: ${failed.map((s) => `${s.code} ${s.error ?? ''}`.trim()).join('; ')}`);
    }
  }

  /** Place a post-only limit order (bid = OpenLong, ask = OpenShort). */
  async placeLimitOrder(side: 'bid' | 'ask', price: number, size: number): Promise<void> {
    const acc = await this.ensureAccount();
    const meta = await this.getMarketMeta();
    const head = await this.getExchangeHead();
    const p = Math.round(price * 10 ** meta.priceDecimals);
    const s = Math.round(size * 10 ** meta.sizeDecimals);
    if (s <= 0 || p <= 0) return; // nothing meaningful to quote
    await this.submitBatch([
      {
        rq: this.nextRq(),
        mkt: this.marketId,
        acc,
        t: side === 'bid' ? 1 : 2, // OpenLong / OpenShort
        p,
        s,
        fl: 1, // PostOnly (maker-only)
        lv: this.config.leverage ?? 100, // hundredths: 100 = 1x
        lb: head + Math.max(1, Math.floor(meta.ttlBlocks / 2)), // mid-band of head < lb <= head+ttl
      },
    ]);
  }

  /** Cancel every resting order this account holds on the quoted market (t:5 by oid). */
  async cancelAllOrders(): Promise<void> {
    const acc = await this.ensureAccount();
    const res = await this.signedRequest('GET', '/v1/trading/orders');
    if (!res.ok) throw new Error(`Perpl open-orders fetch failed: ${res.status} ${await res.text()}`);
    const snapshot = (await res.json()) as { d?: Record<string, any>[] };
    const open = (snapshot.d ?? []).filter(
      (o) => Number(o?.mkt ?? this.marketId) === this.marketId && Number(o?.acc ?? acc) === acc,
    );
    if (open.length === 0) return;
    const meta = await this.getMarketMeta();
    const head = await this.getExchangeHead();
    const lb = head + Math.max(1, Math.floor(meta.ttlBlocks / 2)); // cancels need a valid inclusion deadline too
    await this.submitBatch(
      open.map((o) => ({
        rq: this.nextRq(),
        mkt: Number(o?.mkt ?? this.marketId),
        acc: Number(o?.acc ?? acc),
        oid: Number(o?.oid ?? o?.id),
        t: 5, // Cancel
        s: 0,
        fl: 0,
        lv: 0,
        lb,
      })),
    );
  }

  /** Fetch recent fills over REST. */
  async getFills(): Promise<Fill[]> {
    await this.getMarketMeta(); // ensure decimals are loaded for unscaling
    const res = await this.signedRequest('GET', '/v1/trading/fills');
    if (!res.ok) throw new Error(`Perpl getFills failed: ${res.status}`);
    const data = (await res.json()) as Record<string, any>;
    const raw: any[] = Array.isArray(data) ? data : (data.d ?? data.fills ?? data.data ?? []);
    return raw
      .map((d) => this.toFill(d as Record<string, any>, Number((d as any)?.s ?? 0), Number((d as any)?.f ?? 0)))
      .filter((f): f is Fill => f !== null);
  }

  close(): void {
    this.wsTrading?.close();
    this.wsMarket?.close();
    this.wsTrading = undefined;
    this.wsMarket = undefined;
  }

}

