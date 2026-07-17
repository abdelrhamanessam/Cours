// GET /api/download?mid=MANIFEST_ID[&segment=N]
// Downloads encrypted video segment through API (auth required, private storage)

export async function onRequest(context) {
  const { request, env } = context;
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

  const token = request.headers.get('Authorization')?.slice(7);
  if (!token) return new Response('Unauthorized', { status: 401, headers: cors });
  const user = await verifyUser(token, env);
  if (!user) return new Response('Invalid token', { status: 401, headers: cors });

  const userId = user.id || user.sub;
  if (!checkRateLimit('download:' + userId)) {
    return new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429, headers: cors });
  }

  const url = new URL(request.url);
  const mid = url.searchParams.get('mid');
  const segmentNum = url.searchParams.get('segment');
  if (!mid) return new Response(JSON.stringify({ error: 'Missing mid' }), { status: 400, headers: cors });

  const sbUrl = env.SUPABASE_URL.replace(/\/+$/, '');
  const svc = env.SUPABASE_SERVICE_KEY;

  try {
    const segQuery = segmentNum !== null
      ? `manifest_id=eq.${mid}&segment_num=eq.${segmentNum}&select=file_name,mega_link`
      : `manifest_id=eq.${mid}&select=file_name,mega_link&limit=1`;
    const segs = await supabaseGet('mega_segments', segQuery, env);
    if (!segs || segs.length === 0) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: cors });

    const seg = segs[0];

    // Download from Mega if link is available, otherwise from Supabase storage
    let blob;
    if (seg.mega_link && seg.mega_link.startsWith('https://mega.nz/file/')) {
      blob = await downloadFromMega(seg.mega_link);
      if (!blob) return new Response(JSON.stringify({ error: 'Mega download failed' }), { status: 502, headers: cors });
    } else if (seg.mega_link && seg.mega_link.includes('supabase.co')) {
      // Legacy: file stored in Supabase (old CLI uploads with public URL)
      const fileResp = await fetch(seg.mega_link);
      if (!fileResp.ok) return new Response(JSON.stringify({ error: 'file not found in storage' }), { status: 404, headers: cors });
      blob = await fileResp.blob();
    } else {
      // New upload — not yet migrated to Mega, stored in Supabase private storage
      const fileResp = await fetch(`${sbUrl}/storage/v1/object/encrypted-videos/${seg.file_name}`, {
        headers: { 'authorization': `Bearer ${svc}` }
      });
      if (!fileResp.ok) {
        if (!seg.mega_link || seg.mega_link === '') {
          return new Response(JSON.stringify({ error: 'This video has not been uploaded to Mega yet. The admin must complete the Mega upload process.' }), { status: 503, headers: cors });
        }
        return new Response(JSON.stringify({ error: 'file not found in storage' }), { status: 404, headers: cors });
      }
      blob = await fileResp.blob();
    }

    return new Response(blob, {
      headers: { ...cors, 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'inline' }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}

async function downloadFromMega(megaLink) {
  const match = megaLink.match(/\/file\/([^#]+)#(.+)/);
  if (!match) return null;
  const fileHandle = match[1];
  const keyBase64 = match[2];
  try {
    const apiResp = await fetch('https://g.api.mega.co.nz/cs?id=1', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ a: 'g', g: 1, p: fileHandle }])
    });
    if (!apiResp.ok) return null;
    const data = (await apiResp.json())[0];
    if (!data?.g) return null;

    const dlResp = await fetch(data.g);
    if (!dlResp.ok) return null;
    const encryptedBlob = await dlResp.arrayBuffer();

    // Decrypt Mega's layer using AES-128-CTR
    const decrypted = await megaDecrypt(encryptedBlob, keyBase64);
    return new Blob([decrypted]);
  } catch { return null; }
}

async function megaDecrypt(encryptedData, keyBase64) {
  // Decode URL-safe base64 key
  let b64 = keyBase64.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const keyBytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));

  // Derive AES key: keyBytes[0:16] XOR keyBytes[16:32]
  const aesKeyBytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) aesKeyBytes[i] = keyBytes[i] ^ keyBytes[i + 16];

  const key = await crypto.subtle.importKey('raw', aesKeyBytes, { name: 'AES-CTR' }, false, ['decrypt']);

  // Counter = keyBytes[16:24] + 8 zero bytes
  const counter = new Uint8Array(16);
  counter.set(keyBytes.slice(16, 24), 0);

  return crypto.subtle.decrypt({ name: 'AES-CTR', counter, length: 64 }, key, encryptedData);
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
