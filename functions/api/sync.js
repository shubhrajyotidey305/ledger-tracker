/**
 * Cloudflare Pages Function — /api/sync
 *
 * Replaces the Netlify Blobs backend with Cloudflare KV.
 * Behaviour is identical: GET pulls, PUT pushes, key is SHA-256(sync code)
 * so the server never sees the plain-text code.
 *
 * KV binding required: variable name LEDGER_SYNC
 * Set it in: Cloudflare Dashboard → Pages project → Settings → Functions → KV namespace bindings
 */
export async function onRequest(ctx) {
  const { request, env } = ctx;
  const url = new URL(request.url);
  const key = url.searchParams.get('key');

  if (!key || !/^[a-f0-9]{64}$/.test(key)) {
    return json({ error: 'bad key' }, 400);
  }

  const KV = env.LEDGER_SYNC;
  if (!KV) return json({ error: 'KV namespace not bound — see setup guide' }, 500);

  if (request.method === 'GET') {
    const data = await KV.get(key);
    return new Response(data ?? 'null', {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }

  if (request.method === 'PUT' || request.method === 'POST') {
    const body = await request.text();
    if (body.length > 2_000_000) return json({ error: 'too large' }, 413);
    try { JSON.parse(body); } catch { return json({ error: 'not json' }, 400); }
    await KV.put(key, body);
    return json({ ok: true }, 200);
  }

  return json({ error: 'method not allowed' }, 405);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
