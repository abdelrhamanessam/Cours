// /api/key/:lessonId
// Returns the raw AES-256 master key for decryption

export async function onRequest(context) {
  const { request, env, params } = context;
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

  const token = request.headers.get('Authorization')?.slice(7);
  if (!token) return new Response('Unauthorized', { status: 401, headers: cors });

  const user = await verifyUser(token, env);
  if (!user) return new Response('Invalid token', { status: 401, headers: cors });

  const lessonId = params.lessonId;
  const manifests = await supabaseGet('video_manifests', `lesson_id=eq.${lessonId}&select=id,master_key`, env);
  if (!manifests || manifests.length === 0) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: cors });

  const key = hexToBytes(manifests[0].master_key);
  return new Response(key, { headers: { ...cors, 'Content-Type': 'application/octet-stream' } });
}

async function supabaseGet(table, query, env) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: { 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}` } });
  if (!r.ok) return null;
  return r.json();
}

async function verifyUser(token, env) {
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { 'apikey': env.SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` } });
  if (!r.ok) return null;
  return r.json();
}

function hexToBytes(hex) {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) b[i >> 1] = parseInt(hex.substr(i, 2), 16);
  return b;
}
