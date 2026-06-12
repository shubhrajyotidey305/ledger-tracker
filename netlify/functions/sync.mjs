import { getStore } from "@netlify/blobs";

// Tiny sync endpoint backed by Netlify Blobs.
// The client derives `key` as SHA-256(sync code), so the server never sees the code
// and nobody can read your data without it.
export default async (req) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (!key || !/^[a-f0-9]{64}$/.test(key)) {
    return new Response(JSON.stringify({ error: "bad key" }), { status: 400 });
  }
  const store = getStore("ledger-sync");

  if (req.method === "GET") {
    const data = await store.get(key);
    return new Response(data ?? "null", {
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }

  if (req.method === "PUT" || req.method === "POST") {
    const body = await req.text();
    if (body.length > 2_000_000) {
      return new Response(JSON.stringify({ error: "too large" }), { status: 413 });
    }
    try { JSON.parse(body); } catch {
      return new Response(JSON.stringify({ error: "not json" }), { status: 400 });
    }
    await store.set(key, body);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405 });
};

export const config = { path: "/api/sync" };
