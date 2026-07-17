// POST /api/store-mega-link
// Stores a Mega.nz link for a video segment after browser-side upload to Mega

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
    const { manifestId, segmentNum, megaLink } = await request.json();
    if (!manifestId || segmentNum === undefined || !megaLink) {
      return new Response(JSON.stringify({ error: 'Missing manifestId, segmentNum, or megaLink' }), { status: 400, headers: cors });
    }

    const svc = env.SUPABASE_SERVICE_KEY;
    const sbUrl = env.SUPABASE_URL.replace(/\/+$/, '');
    const q = `manifest_id=eq.${manifestId}&segment_num=eq.${segmentNum}`;
    const res2 = await fetch(`${sbUrl}/rest/v1/mega_segments?${q}`, {
      method: 'PATCH',
      headers: { 'apikey': svc, 'Authorization': `Bearer ${svc}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ mega_link: megaLink })
    });

    if (!res2.ok) {
      const text = await res2.text();
      return new Response(JSON.stringify({ error: 'DB update failed', detail: text }), { status: 500, headers: cors });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}

async function verifyUser(token, env) {
  const r = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/user`, { headers: { 'apikey': env.SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` } });
  if (!r.ok) return null;
  return r.json();
}
