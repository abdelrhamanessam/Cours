// POST /api/access-token
// Creates a short-lived access token (5 min) from a valid page ticket

export async function onRequest(context) {
  const { request, env } = context;
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

  const token = request.headers.get('Authorization')?.slice(7);
  if (!token) return new Response('Unauthorized', { status: 401, headers: cors });
  const user = await verifyUser(token, env);
  if (!user) return new Response('Invalid token', { status: 401, headers: cors });

  try {
    const body = await request.json();
    const pageTicket = body.ticket;
    if (!pageTicket) return new Response(JSON.stringify({ error: 'Missing ticket' }), { status: 400, headers: cors });

    const secret = env.MASTER_SECRET || env.SUPABASE_SERVICE_KEY;
    const verified = await verifyTicket(secret, pageTicket);
    if (!verified) return new Response(JSON.stringify({ error: 'Invalid or expired ticket' }), { status: 403, headers: cors });

    // Create short-lived access token (5 min)
    const ttlMs = 5 * 60 * 1000;
    const expiresAt = Date.now() + ttlMs;
    const payload = `${verified.manifestId}:${user.id}:${expiresAt}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    const accessToken = btoa(payload + ':' + sigHex);

    return new Response(JSON.stringify({ accessToken, manifestId: verified.manifestId, expiresAt }), {
      status: 200, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}

async function verifyTicket(secret, ticket) {
  try {
    const decoded = atob(ticket);
    const lastColon = decoded.lastIndexOf(':');
    const data = decoded.substring(0, lastColon);
    const sigHex = decoded.substring(lastColon + 1);
    const parts = data.split(':');
    if (parts.length < 3) return null;
    const manifestId = parts[0];
    const userId = parts[1];
    const expiresAt = parseInt(parts[2]);
    if (Date.now() > expiresAt) return null;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const sigBytes = new Uint8Array(sigHex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(data));
    return valid ? { manifestId, userId } : null;
  } catch(e) { return null; }
}

async function verifyUser(token, env) {
  const r = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/user`, { headers: { 'apikey': env.SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` } });
  if (!r.ok) return null;
  return r.json();
}
