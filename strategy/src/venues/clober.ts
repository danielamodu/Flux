// clober.ts — Clober V2 CLOB venue adapter (Monad). SCAFFOLD ONLY.
//
// Clober V2 is NOT deployed on the current Monad testnet: every address shipped
// in @clober/v2-sdk v1.0.3 returns codesize 0 (verified on-chain — the
// 2025-12-16 testnet reset wiped the deployment and it has not been redeployed).
// This adapter implements the VenueAdapter shape so the engine can switch Clober
// on the moment it redeploys, but connect() refuses until then.
//
// TODO(clober): when Clober redeploys to Monad testnet, wire connect() to the
// Controller + BookManager. Last-known testnet BookManager (pre-reset, now empty):
//     0xAA9575d63dFC224b9583fC303dB3188C08d5C85A
// Clober specifics to implement then: open maker orders are ERC-721 NFTs (minted
// on place, burned on full cancel/claim); all state mutations route through the
// Controller (locker pattern); a mandatory claim() step settles filled orders.
import * as CloberSdk from '@clober/v2-sdk';
import type { Order, Fill, VenueAdapter } from './types.js';

const NOT_CONNECTED = 'Clober adapter not connected';

export class CloberAdapter implements VenueAdapter {
  readonly name = 'clober';
  readonly pair = 'UNCONFIGURED';
  // Load-bearing reference: keeps the @clober/v2-sdk dependency real and wired
  // even though connect() short-circuits before any SDK call is made.
  private readonly sdk = CloberSdk;

  async connect(): Promise<void> {
    console.log(`[${new Date().toISOString()}] [CloberAdapter] waiting for Monad testnet deployment`);
    void this.sdk;
    throw new Error('Clober not yet deployed on Monad testnet — adapter ready, awaiting deployment');
  }

  close(): void {}

  async getMidPrice(): Promise<number> {
    throw new Error(NOT_CONNECTED);
  }

  async placeOrders(_bid: Order, _ask: Order): Promise<void> {
    throw new Error(NOT_CONNECTED);
  }

  async cancelAllOrders(): Promise<void> {
    throw new Error(NOT_CONNECTED);
  }

  async getFills(): Promise<Fill[]> {
    throw new Error(NOT_CONNECTED);
  }

  onFill(_callback: (fill: Fill) => void): void {
    throw new Error(NOT_CONNECTED);
  }
}
