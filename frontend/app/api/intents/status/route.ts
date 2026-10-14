// Server-side proxy for the Aurora Intents swap-status endpoint.
const API_BASE =
  process.env.INTENTS_API_BASE?.trim() || 'https://intents-api.aurora.dev';

export async function GET(req: Request): Promise<Response> {
  const apiKey = process.env.INTENTS_API_KEY?.trim();
  if (!apiKey) {
    return Response.json(
      { message: 'Intents deposits are not configured on the server.' },
      { status: 503 },
    );
  }
  const url = new URL(req.url);
  const depositAddress = url.searchParams.get('depositAddress');
  if (!depositAddress) {
    return Response.json(
      { message: 'depositAddress is required.' },
      { status: 400 },
    );
  }
  const query = new URLSearchParams({ depositAddress });
  const memo = url.searchParams.get('depositMemo');
  if (memo) query.set('depositMemo', memo);

  const upstream = await fetch(
    `${API_BASE}/api/status/${apiKey}?${query.toString()}`,
  );
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { 'content-type': 'application/json' },
  });
}
