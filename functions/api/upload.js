// POST /api/upload
// Uploads an encrypted video to Supabase Storage + saves manifest using service key
export async function onRequest(context) {
  const { request, env } = context;
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

  const token = request.headers.get('Authorization')?.slice(7);
  if (!token) return new Response('Unauthorized', { status: 401, headers: cors });
  const user = await verifyUser(token, env);
  if (!user) return new Response('Invalid token', { status: 401, headers: cors });

  const sbUrl = env.SUPABASE_URL.replace(/\/+$/, '');
  const svc = env.SUPABASE_SERVICE_KEY;

  try {
    const form = await request.formData();
    const file = form.get('file');
    const fileName = form.get('fileName') || `admin_uploads/${Date.now()}_video.enc`;
    const keyHex = form.get('keyHex');
    const ivHex = form.get('ivHex');
    const originalName = form.get('originalName') || fileName;

    if (!file || !keyHex || !ivHex) return new Response(JSON.stringify({ error: 'Missing file, keyHex, or ivHex' }), { status: 400, headers: cors });

    // Upload to Supabase Storage via service key
    const upRes = await fetch(`${sbUrl}/storage/v1/object/encrypted-videos/${fileName}`, {
      method: 'POST',
      headers: { 'authorization': `Bearer ${svc}`, 'x-upsert': 'true', 'content-type': 'application/octet-stream' },
      body: file
    });
    if (!upRes.ok) return new Response(JSON.stringify({ error: 'Storage upload failed', detail: await upRes.text() }), { status: 500, headers: cors });

    const publicUrl = `${sbUrl}/storage/v1/object/public/encrypted-videos/${fileName}`;
    const manifestId = crypto.randomUUID();

    // Insert manifest
    const insRes = await fetch(`${sbUrl}/rest/v1/video_manifests`, {
      method: 'POST',
      headers: { 'apikey': svc, 'Authorization': `Bearer ${svc}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        id: manifestId, course_id: null, lesson_id: null,
        master_key: keyHex, total_segments: 1, segment_duration: 0,
        created_at: new Date().toISOString()
      })
    });
    if (!insRes.ok) return new Response(JSON.stringify({ error: 'DB insert failed', detail: await insRes.text() }), { status: 500, headers: cors });

    const segRes = await fetch(`${sbUrl}/rest/v1/mega_segments`, {
      method: 'POST',
      headers: { 'apikey': svc, 'Authorization': `Bearer ${svc}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        manifest_id: manifestId, segment_num: 1, account_index: 1,
        file_name: originalName, iv: ivHex, mega_link: publicUrl
      })
    });
    if (!segRes.ok) return new Response(JSON.stringify({ error: 'Segment insert failed', detail: await segRes.text() }), { status: 500, headers: cors });

    return new Response(JSON.stringify({ manifestId, fileName }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}

async function verifyUser(token, env) {
  const r = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/user`, { headers: { 'apikey': env.SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` } });
  if (!r.ok) return null;
  return r.json();
}
