// /api/key/:lessonId
// Returns the raw AES-256 key for decryption

export async function onRequest(context) {
  const { request, env, params } = context;
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

  const token = request.headers.get('Authorization')?.slice(7);
  if (!token) return new Response('Unauthorized', { status: 401, headers: cors });

  const user = await verifyUser(token, env);
  if (!user) return new Response('Invalid token', { status: 401, headers: cors });

  const userId = user.id || user.sub;
  if (!checkRateLimit('key:' + userId)) {
    return new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429, headers: cors });
  }

  const lessonId = params.lessonId;
  const url = new URL(request.url);
  const mid = url.searchParams.get('mid');

  const query = mid ? `id=eq.${mid}&select=id,master_key` : `lesson_id=eq.${lessonId}&select=id,master_key`;
  const manifests = await supabaseGet('video_manifests', query, env);
  if (!manifests || manifests.length === 0) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: cors });

  const manifest = manifests[0];
  let key;

  if (env.MASTER_SECRET && !manifest.master_key) {
    key = await deriveKey(env.MASTER_SECRET, String(manifest.id));
  } else {
    key = hexToBytes(manifest.master_key);
  }

  // Log access (non-blocking)
  context.waitUntil((async () => {
    try {
      const sbUrlVal = env.SUPABASE_URL.replace(/\/+$/, '');
      const svc = env.SUPABASE_SERVICE_KEY;
      const manifestId = manifest.id;
      const cf = request.cf || {};
      await fetch(`${sbUrlVal}/rest/v1/video_access_log`, {
        method: 'POST',
        headers: { 'apikey': svc, 'Authorization': `Bearer ${svc}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          user_id: userId,
          manifest_id: manifestId,
          action: 'key_access',
          ip_address: cf.ip || '',
          user_agent: request.headers.get('User-Agent') || ''
        })
      });
    } catch(e) { /* silent */ }
  })());

  return new Response(key, { headers: { ...cors, 'Content-Type': 'application/octet-stream' } });
}

async function deriveKey(secret, manifestId) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('mr-maths-video-key-v1'), info: encoder.encode(manifestId) },
    keyMaterial, 256
  );
  return new Uint8Array(bits);
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

function hexToBytes(hex) {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) b[i >> 1] = parseInt(hex.substr(i, 2), 16);
  return b;
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
