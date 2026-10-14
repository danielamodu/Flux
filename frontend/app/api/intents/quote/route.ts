// Server-side proxy for the Intents quote endpoint. Keeps INTENTS_API_KEY
// off the client and injects Flux's referral + optional app fee (the
// integrator revenue share) into every quote request.
const API_BASE =
  process.env.INTENTS_API_BASE?.trim() || 'https://1click.chaindefuser.com';

export async function POST(req: Request): Promise<Response> {
  const apiKey = process.env.INTENTS_API_KEY?.trim();
  if (!apiKey) {
    return Response.json(
      {
        message:
          'Intents deposits are not configured: set INTENTS_API_KEY on the server (Partner Dashboard) to enable any-chain quotes.',
      },
      { status: 503 },
    );
  }

  let params: {
    originAsset?: string;
    amount?: string;
    recipient?: string;
    slippageTolerance?: number;
    dry?: boolean;
  };
  try {
    params = await req.json();
  } catch {
    return Response.json({ message: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!params.originAsset || !params.amount || !params.recipient) {
    return Response.json(
      { message: 'originAsset, amount, and recipient are required.' },
      { status: 400 },
    );
  }

  const feeRecipient = process.env.INTENTS_FEE_RECIPIENT?.trim();
  const feeBps = Number(process.env.INTENTS_FEE_BPS ?? '0');

  const upstream = await fetch(`${API_BASE}/v0/quote`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({
      dry: params.dry ?? true,
      swapType: 'EXACT_INPUT',
      slippageTolerance: params.slippageTolerance ?? 100,
      originAsset: params.originAsset,
      depositType: 'ORIGIN_CHAIN',
      // Flux settles in USDC on Monad; see lib/intents.ts for the
      // mainnet/testnet note.
      destinationAsset:
        'nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx',
      amount: params.amount,
      refundTo: params.recipient,
      refundType: 'ORIGIN_CHAIN',
      recipient: params.recipient,
      recipientType: 'DESTINATION_CHAIN',
      deadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      referral: 'flux',
      ...(feeRecipient && Number.isFinite(feeBps) && feeBps > 0
        ? { appFees: [{ recipient: feeRecipient, fee: Math.round(feeBps) }] }
        : {}),
    }),
  });
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { 'content-type': 'application/json' },
  });
}
