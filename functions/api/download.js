// GET /api/download?mid=MANIFEST_ID
// Downloads encrypted video file through API (auth required, private storage)

export async function onRequest(context) {
  const { request, env } = context;
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

  const token = request.headers.get('Authorization')?.slice(7);
  if (!token) return new Response('Unauthorized', { status: 401, headers: cors });
  const user = await verifyUser(token, env);
  if (!user) return new Response('Invalid token', { status: 401, headers: cors });

  const url = new URL(request.url);
  const mid = url.searchParams.get('mid');
  if (!mid) return new Response(JSON.stringify({ error: 'Missing mid' }), { status: 400, headers: cors });

  const sbUrl = env.SUPABASE_URL.replace(/\/+$/, '');
  const svc = env.SUPABASE_SERVICE_KEY;

  try {
    const segs = await supabaseGet('mega_segments', `manifest_id=eq.${mid}&select=file_name&limit=1`, env);
    if (!segs || segs.length === 0) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: cors });

    const fileName = segs[0].file_name;
    const storagePath = fileName.startsWith('admin_uploads/') || fileName.startsWith('course_') ? fileName : `admin_uploads/${fileName}`;

    const fileResp = await fetch(`${sbUrl}/storage/v1/object/encrypted-videos/${fileName}`, {
      headers: { 'authorization': `Bearer ${svc}` }
    });
    if (!fileResp.ok) return new Response(JSON.stringify({ error: 'file not found in storage' }), { status: 404, headers: cors });

    const blob = await fileResp.blob();
    return new Response(blob, {
      headers: { ...cors, 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'inline' }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
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
