// index.ts — venue adapter registry.
//
// One import surface for the strategy engine: the common types, every adapter,
// and a name -> constructor map so venues can be enabled by configuration.
export type { Order, Fill, VenueAdapter } from './types.js';
export { PerplAdapter } from './perpl.js';
export { KuruAdapter } from './kuru.js';
export { CloberAdapter } from './clober.js';

import { PerplAdapter } from './perpl.js';
import { KuruAdapter } from './kuru.js';
import { CloberAdapter } from './clober.js';

/** Registry of known venue adapters, keyed by their `name`. */
export const VENUE_ADAPTERS = {
  perpl: PerplAdapter,
  kuru: KuruAdapter,
  clober: CloberAdapter,
} as const;

export type VenueName = keyof typeof VENUE_ADAPTERS;
