// POST /api/mega-upload
// Server-side upload of encrypted segment to Mega.nz
// Admin-only. Credentials are read from env var (not sent by client)

import {
  CORS_HEADERS, handleOptions, corsResponse,
  verifyUser, checkAdmin, parseAuthToken,
} from '../_shared.js';

// Mega credentials are stored in env vars:
// MEGA_EMAIL, MEGA_PASSWORD
// For multiple accounts: MEGA_ACCOUNTS (JSON array of {email, password, label})

export async function onRequest(context) {
  const { request, env } = context;

  const opt = handleOptions(request);
  if (opt) return opt;

  if (request.method !== 'POST') {
    return corsResponse('Method not allowed', 405);
  }

  const token = parseAuthToken(request);
  if (!token) return corsResponse({ error: 'Unauthorized' }, 401);

  const user = await verifyUser(token, env);
  if (!user) return corsResponse({ error: 'Invalid token' }, 401);

  const isAdmin = await checkAdmin(user, env);
  if (!isAdmin) return corsResponse({ error: 'Forbidden: admin only' }, 403);

  try {
    const { segmentData, fileName, manifestId, segmentNum, iv, videoName } = await request.json();
    if (!segmentData || !fileName || !manifestId || segmentNum === undefined) {
      return corsResponse({ error: 'Missing required fields' }, 400);
    }

    // Decode base64 segment data
    const binaryStr = atob(segmentData);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    // Determine which Mega account to use
    let megaEmail = env.MEGA_EMAIL;
    let megaPassword = env.MEGA_PASSWORD;

    // Support for multiple accounts via env var JSON
    if (!megaEmail && env.MEGA_ACCOUNTS) {
      try {
        const accounts = JSON.parse(env.MEGA_ACCOUNTS);
        // Simple round-robin by manifestId hash
        const idx = Math.abs(hashCode(manifestId)) % accounts.length;
        megaEmail = accounts[idx].email;
        megaPassword = accounts[idx].password;
      } catch {
        // fall through
      }
    }

    if (!megaEmail || !megaPassword) {
      return corsResponse({
        error: 'Mega credentials not configured. Set MEGA_EMAIL and MEGA_PASSWORD env vars.',
      }, 500);
    }

    // Login to Mega (dynamic import of megajs)
    let Mega;
    try {
      Mega = await import('megajs');
    } catch {
      return corsResponse({ error: 'megajs library not available on server' }, 500);
    }

    const storage = await new Promise((resolve, reject) => {
      const s = new Mega.default({ email: megaEmail, password: megaPassword });
      s.on('ready', () => resolve(s));
      s.on('error', reject);
    });

    // Upload to Mega
    const megaFile = await storage.upload({ name: fileName }, bytes).complete;
    const link = await megaFile.link();

    // Store the link in DB
    const svc = env.SUPABASE_SERVICE_KEY;
    const sbUrl = env.SUPABASE_URL.replace(/\/+$/, '');
    const q = `manifest_id=eq.${manifestId}&segment_num=eq.${segmentNum}`;
    const updateBody = videoName && segmentNum === 0
      ? { mega_link: link, file_name: videoName }
      : { mega_link: link };

    const res = await fetch(`${sbUrl}/rest/v1/mega_segments?${q}`, {
      method: 'PATCH',
      headers: {
        'apikey': svc, 'Authorization': `Bearer ${svc}`,
        'Content-Type': 'application/json', 'Prefer': 'return=minimal',
      },
      body: JSON.stringify(updateBody),
    });

    if (!res.ok) {
      return corsResponse({
        error: 'DB update failed after Mega upload', detail: await res.text(),
      }, 500);
    }

    return corsResponse({
      ok: true,
      manifestId,
      segmentNum,
      megaLink: link,
    });

  } catch (e) {
    return corsResponse({ error: 'Mega upload failed: ' + e.message }, 500);
  }
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash;
}
