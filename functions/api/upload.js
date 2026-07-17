// POST /api/upload
// Accepts raw video file, encrypts server-side, stores to private Supabase Storage

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
    const originalName = form.get('originalName') || form.get('fileName') || 'video.mp4';
    if (!file) return new Response(JSON.stringify({ error: 'Missing file' }), { status: 400, headers: cors });

    const fileData = await file.arrayBuffer();
    const manifestId = crypto.randomUUID();

    const rawKey = await deriveKey(env.MASTER_SECRET, manifestId);
    const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt']);

    const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB per segment
    const totalBytes = fileData.byteLength;
    const numSegments = Math.max(1, Math.ceil(totalBytes / CHUNK_SIZE));

    // Create manifest
    const insRes = await fetch(`${sbUrl}/rest/v1/video_manifests`, {
      method: 'POST',
      headers: { 'apikey': svc, 'Authorization': `Bearer ${svc}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        id: manifestId, course_id: null, lesson_id: null,
        master_key: null, total_segments: numSegments, segment_duration: 0,
        created_at: new Date().toISOString()
      })
    });
    if (!insRes.ok) return new Response(JSON.stringify({ error: 'DB insert failed', detail: await insRes.text() }), { status: 500, headers: cors });

    const uploadedFileNames = [];
    for (let i = 0; i < numSegments; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, totalBytes);
      const chunk = fileData.slice(start, end);

      const iv = crypto.getRandomValues(new Uint8Array(16));
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, chunk);

      const encData = new Uint8Array(iv.byteLength + encrypted.byteLength);
      encData.set(new Uint8Array(iv), 0);
      encData.set(new Uint8Array(encrypted), iv.byteLength);

      const storageName = `admin_uploads/${manifestId}/seg_${i}.enc`;
      uploadedFileNames.push(storageName);

      const upRes = await fetch(`${sbUrl}/storage/v1/object/encrypted-videos/${storageName}`, {
        method: 'POST',
        headers: { 'authorization': `Bearer ${svc}`, 'x-upsert': 'true', 'content-type': 'application/octet-stream' },
        body: encData
      });
      if (!upRes.ok) return new Response(JSON.stringify({ error: `Segment ${i} upload failed`, detail: await upRes.text() }), { status: 500, headers: cors });

      const segRes = await fetch(`${sbUrl}/rest/v1/mega_segments`, {
        method: 'POST',
        headers: { 'apikey': svc, 'Authorization': `Bearer ${svc}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          manifest_id: manifestId, segment_num: i, account_index: 1,
          file_name: storageName, iv: bytesToHex(iv), mega_link: ''
        })
      });
      if (!segRes.ok) return new Response(JSON.stringify({ error: `Segment ${i} insert failed`, detail: await segRes.text() }), { status: 500, headers: cors });
    }

    return new Response(JSON.stringify({ manifestId, totalSegments: numSegments, segments: uploadedFileNames }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
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

function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyUser(token, env) {
  const r = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/user`, { headers: { 'apikey': env.SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` } });
  if (!r.ok) return null;
  return r.json();
}
