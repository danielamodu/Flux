// Aurora/NEAR Intents deposit rail (1Click Swap API).
//
// Lets a user fund Flux from any supported chain: they pick an origin asset,
// we request a quote whose destination is USDC on Monad, they send the origin
// tokens to the returned deposit address, and Intents delivers USDC to their
// Monad address. All API calls go through /api/intents/* so the partner key
// stays server-side.
//
// Live limitation (Oct 2026): Intents serves Monad mainnet (chain 143), not
// Monad testnet (10143). Swaps therefore deliver mainnet USDC
// (0x7547…b603); wiring testnet delivery is a config change once Intents
// lists the testnet asset. The UI states this instead of implying otherwise.

export interface IntentsAsset {
  id: string;
  chain: string;
  symbol: string;
  decimals: number;
}

// Origin assets verified against the 1Click token list, 2026-10-14.
export const INTENTS_ORIGIN_ASSETS: IntentsAsset[] = [
  {
    id: 'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near',
    chain: 'Ethereum',
    symbol: 'USDC',
    decimals: 6,
  },
  {
    id: 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near',
    chain: 'Arbitrum',
    symbol: 'USDC',
    decimals: 6,
  },
  {
    id: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
    chain: 'Base',
    symbol: 'USDC',
    decimals: 6,
  },
  {
    id: 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near',
    chain: 'Solana',
    symbol: 'USDC',
    decimals: 6,
  },
];

// Intents delivery target: Circle USDC on Monad mainnet.
// Flux's vault lives on Monad testnet; see the module note above.
export const INTENTS_DESTINATION_ASSET = {
  id: 'nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx',
  chain: 'Monad',
  symbol: 'USDC',
  decimals: 6,
  contract: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603',
} as const;

export type IntentsStatus =
  | 'PENDING_DEPOSIT'
  | 'KNOWN_DEPOSIT_TX'
  | 'INCOMPLETE_DEPOSIT'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'REFUNDED'
  | 'FAILED';

export interface IntentsQuote {
  depositAddress: string;
  depositMemo?: string;
  amountIn: string;
  amountInFormatted: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd: string;
  minAmountOut: string;
  deadline: string;
  timeEstimate: number;
}

interface QuoteResponse {
  quote: IntentsQuote;
  signature: string;
  correlationId: string;
}

interface StatusResponse {
  status: IntentsStatus;
  quoteResponse: QuoteResponse;
  updatedAt: string;
}

async function asJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { message: text || `HTTP ${res.status}` };
  }
}

function apiError(body: unknown, fallback: string): Error {
  const message =
    typeof body === 'object' && body !== null && 'message' in body
      ? String((body as { message: unknown }).message)
      : fallback;
  return new Error(message);
}

/** Dry quote (no deposit address) for previewing the rate. */
export async function previewIntentsSwap(params: {
  originAsset: string;
  amount: string;
  recipient: string;
  slippageTolerance?: number;
}): Promise<{ amountOutFormatted: string; amountOutUsd: string }> {
  const res = await fetch('/api/intents/quote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...params, dry: true }),
  });
  const body = await asJson(res);
  if (!res.ok) throw apiError(body, 'Quote preview failed');
  const quote = (body as QuoteResponse).quote;
  return {
    amountOutFormatted: quote.amountOutFormatted,
    amountOutUsd: quote.amountOutUsd,
  };
}

/** Live quote: returns the deposit address the user must fund. */
export async function requestIntentsSwap(params: {
  originAsset: string;
  amount: string;
  recipient: string;
  slippageTolerance?: number;
}): Promise<QuoteResponse> {
  const res = await fetch('/api/intents/quote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...params, dry: false }),
  });
  const body = await asJson(res);
  if (!res.ok) throw apiError(body, 'Quote request failed');
  return body as QuoteResponse;
}

export async function pollIntentsStatus(params: {
  depositAddress: string;
  depositMemo?: string;
}): Promise<IntentsStatus> {
  const query = new URLSearchParams({ depositAddress: params.depositAddress });
  if (params.depositMemo) query.set('depositMemo', params.depositMemo);
  const res = await fetch(`/api/intents/status?${query.toString()}`);
  const body = await asJson(res);
  if (!res.ok) throw apiError(body, 'Status check failed');
  return (body as StatusResponse).status;
}
