// /api/manifest/:lessonId
// Returns segment manifest for a lesson

export async function onRequest(context) {
  const { request, env, params } = context;
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

  const token = request.headers.get('Authorization')?.slice(7);
  if (!token) return new Response('Unauthorized', { status: 401, headers: cors });

  const user = await verifyUser(token, env);
  if (!user) return new Response('Invalid token', { status: 401, headers: cors });

  const userId = user.id || user.sub;
  if (!checkRateLimit('manifest:' + userId)) {
    return new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429, headers: cors });
  }

  const lessonId = params.lessonId;
  const url = new URL(request.url);
  let mid = url.searchParams.get('mid');
  const ticket = url.searchParams.get('ticket');

  // If ticket is provided, verify it and extract manifestId
  if (ticket) {
    const ticketSecret = env.MASTER_SECRET || env.SUPABASE_SERVICE_KEY;
    const verifiedMid = await verifyTicket(ticketSecret, ticket);
    if (!verifiedMid) return new Response(JSON.stringify({ error: 'Invalid or expired ticket' }), { status: 403, headers: cors });
    mid = verifiedMid;
  }

  const query = mid ? `id=eq.${mid}&select=id,total_segments,segment_duration` : `lesson_id=eq.${lessonId}&select=id,total_segments,segment_duration`;
  const manifests = await supabaseGet('video_manifests', query, env);
  if (!manifests || manifests.length === 0) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: cors });

  const m = manifests[0];
  const segments = await supabaseGet('mega_segments', `manifest_id=eq.${m.id}&select=segment_num,mega_link,iv,file_name&order=segment_num.asc`, env);
  return new Response(JSON.stringify({ manifestId: m.id, totalSegments: m.total_segments, segmentDuration: m.segment_duration, segments: segments || [] }), { headers: { ...cors, 'Content-Type': 'application/json' } });
}

async function verifyTicket(secret, ticket) {
  try {
    const decoded = atob(ticket);
    const lastColon = decoded.lastIndexOf(':');
    const data = decoded.substring(0, lastColon);
    const sigHex = decoded.substring(lastColon + 1);
    const lastDataColon = data.lastIndexOf(':');
    const manifestId = data.substring(0, lastDataColon);
    const expiresAt = parseInt(data.substring(lastDataColon + 1));
    if (Date.now() > expiresAt) return null;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const sigBytes = new Uint8Array(sigHex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(data));
    return valid ? manifestId : null;
  } catch(e) { return null; }
}

function sbUrl(env) { return env.SUPABASE_URL.replace(/\/+$/, ''); }

async function supabaseGet(table, query, env) {
  const r = await fetch(`${sbUrl(env)}/rest/v1/${table}?${query}`, { headers: { 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}` } });
  if (!r.ok) return null;
  return r.json();
}

async function verifyUser(token, env) {
  const r = await fetch(`${sbUrl(env)}/auth/v1/user`, { headers: { 'apikey': env.SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` } });
  if (!r.ok) return null;
  return r.json();
}

const rateLimitStore = {};

function checkRateLimit(key, limit = 20, windowMs = 60000) {
  const now = Date.now();
  let entry = rateLimitStore[key];
  if (!entry || now > entry.resetAt) {
    entry = { count: 1, resetAt: now + windowMs };
    rateLimitStore[key] = entry;
    return true;
  }
  entry.count++;
  return entry.count <= limit;
}
