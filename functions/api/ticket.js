// POST /api/ticket?mid=MANIFEST_ID
// Creates a page ticket (24h expiry) for video access

export async function onRequest(context) {
  const { request, env } = context;
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

  const token = request.headers.get('Authorization')?.slice(7);
  if (!token) return new Response('Unauthorized', { status: 401, headers: cors });
  const user = await verifyUser(token, env);
  if (!user) return new Response('Invalid token', { status: 401, headers: cors });

  const url = new URL(request.url);
  const mid = url.searchParams.get('mid');
  if (!mid) return new Response(JSON.stringify({ error: 'Missing mid' }), { status: 400, headers: cors });

  const secret = env.MASTER_SECRET || env.SUPABASE_SERVICE_KEY;
  const ttlMs = 24 * 60 * 60 * 1000; // 24 hours
  const expiresAt = Date.now() + ttlMs;
  const payload = `${mid}:${user.id}:${expiresAt}`;

  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    const ticket = btoa(payload + ':' + sigHex);

    return new Response(JSON.stringify({ ticket, manifestId: mid, expiresAt, userId: user.id }), {
      status: 200, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}

async function verifyUser(token, env) {
  const r = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/user`, { headers: { 'apikey': env.SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` } });
  if (!r.ok) return null;
  return r.json();
}
