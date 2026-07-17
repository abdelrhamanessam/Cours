// GET /api/download?mid=MANIFEST_ID[&segment=N]
// Downloads encrypted video segment through CF proxy
// mega_link is resolved server-side — never exposed to client

import {
  CORS_HEADERS, handleOptions, corsResponse, mergeHeaders, SECURITY_HEADERS,
  verifyUser, checkEnrollment, supabaseGet, checkRateLimit,
  parseAuthToken, getClientIp,
} from '../_shared.js';

export async function onRequest(context) {
  const { request, env } = context;

  const opt = handleOptions(request);
  if (opt) return opt;

  const token = parseAuthToken(request);
  if (!token) return corsResponse({ error: 'Unauthorized' }, 401);

  const user = await verifyUser(token, env);
  if (!user) return corsResponse({ error: 'Invalid token' }, 401);

  const userId = user.id || user.sub;

  if (!checkRateLimit('download:' + userId, 60, 60000)) {
    return corsResponse({ error: 'Too many requests' }, 429);
  }

  const url = new URL(request.url);
  const mid = url.searchParams.get('mid');
  const segmentNum = url.searchParams.get('segment');
  if (!mid) return corsResponse({ error: 'Missing mid' }, 400);

  // Enrollment check
  const enrolled = await checkEnrollment(userId, null, env);
  if (!enrolled) {
    return corsResponse({ error: 'Access denied: not enrolled' }, 403);
  }

  const svc = env.SUPABASE_SERVICE_KEY;
  const sbUrl = env.SUPABASE_URL.replace(/\/+$/, '');

  try {
    const segQuery = segmentNum !== null
      ? `manifest_id=eq.${mid}&segment_num=eq.${segmentNum}&select=file_name,mega_link`
      : `manifest_id=eq.${mid}&select=file_name,mega_link&limit=1`;
    const segs = await supabaseGet('mega_segments', segQuery, env);
    if (!segs || segs.length === 0) {
      return corsResponse({ error: 'not found' }, 404);
    }

    const seg = segs[0];

    // Download from Mega (server-side proxy) or Supabase storage
    let blob;
    if (seg.mega_link && seg.mega_link.startsWith('https://mega.nz/file/')) {
      blob = await downloadFromMega(seg.mega_link);
      if (!blob) return corsResponse({ error: 'Mega download failed' }, 502);
    } else if (seg.mega_link && seg.mega_link.includes('supabase.co')) {
      // Legacy: public Supabase URL
      const fileResp = await fetch(seg.mega_link);
      if (!fileResp.ok) return corsResponse({ error: 'file not found in storage' }, 404);
      blob = await fileResp.blob();
    } else {
      // Private Supabase storage
      const fileResp = await fetch(
        `${sbUrl}/storage/v1/object/encrypted-videos/${seg.file_name}`,
        { headers: { 'authorization': `Bearer ${svc}` } }
      );
      if (!fileResp.ok) {
        if (!seg.mega_link || seg.mega_link === '') {
          return corsResponse({
            error: 'This video has not been uploaded to Mega yet. The admin must complete the Mega upload process.',
          }, 503);
        }
        return corsResponse({ error: 'file not found in storage' }, 404);
      }
      blob = await fileResp.blob();
    }

    return new Response(blob, {
      headers: mergeHeaders(CORS_HEADERS, SECURITY_HEADERS, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'inline',
      }),
    });

  } catch (e) {
    return corsResponse({ error: e.message }, 500);
  }
}

async function downloadFromMega(megaLink) {
  const match = megaLink.match(/\/file\/([^#]+)#(.+)/);
  if (!match) return null;
  const fileHandle = match[1];
  const keyBase64 = match[2];
  try {
    const apiResp = await fetch('https://g.api.mega.co.nz/cs?id=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ a: 'g', g: 1, p: fileHandle }]),
    });
    if (!apiResp.ok) return null;
    const data = (await apiResp.json())[0];
    if (!data?.g) return null;

    const dlResp = await fetch(data.g);
    if (!dlResp.ok) return null;
    const encryptedBlob = await dlResp.arrayBuffer();

    // Decrypt Mega's AES-128-CTR layer
    const decrypted = await megaDecrypt(encryptedBlob, keyBase64);
    return new Blob([decrypted]);
  } catch {
    return null;
  }
}

async function megaDecrypt(encryptedData, keyBase64) {
  let b64 = keyBase64.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const keyBytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));

  // XOR two halves to get AES-128 key
  const aesKeyBytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) aesKeyBytes[i] = keyBytes[i] ^ keyBytes[i + 16];

  const key = await crypto.subtle.importKey(
    'raw', aesKeyBytes, { name: 'AES-CTR' }, false, ['decrypt']
  );

  const counter = new Uint8Array(16);
  counter.set(keyBytes.slice(16, 24), 0);

  return crypto.subtle.decrypt(
    { name: 'AES-CTR', counter, length: 64 }, key, encryptedData
  );
}
