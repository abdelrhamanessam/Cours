// /api/key/:lessonId
// Returns a session-bound decryption key (never the master key)
// Authorization chain: JWT → enrollment → rate limit → derive

import {
  CORS_HEADERS, handleOptions, corsResponse, mergeHeaders, SECURITY_HEADERS,
  verifyUser, checkEnrollment, supabaseGet, checkRateLimit,
  verifyTokenSignature, deriveKey, hexToBytes,
  parseAuthToken, getClientIp,
} from '../_shared.js';

export async function onRequest(context) {
  const { request, env, params } = context;

  const opt = handleOptions(request);
  if (opt) return opt;

  // ── 1. Verify JWT ──────────────────────────────────
  const token = parseAuthToken(request);
  if (!token) return corsResponse({ error: 'Unauthorized' }, 401);

  const user = await verifyUser(token, env);
  if (!user) return corsResponse({ error: 'Invalid token' }, 401);

  const userId = user.id || user.sub;

  // ── 2. Rate limit per user ─────────────────────────
  if (!checkRateLimit('key:' + userId, 20, 60000)) {
    return corsResponse({ error: 'Too many requests' }, 429);
  }

  const lessonId = params.lessonId;
  const url = new URL(request.url);
  let mid = url.searchParams.get('mid');
  const ticket = url.searchParams.get('ticket');
  const accessToken = url.searchParams.get('access_token');

  // ── 3. Ticket / Access Token verification ──────────
  const secret = env.MASTER_SECRET;
  if (!secret) return corsResponse({ error: 'Server misconfiguration' }, 500);

  if (ticket) {
    const verified = await verifyTokenSignature(secret, ticket);
    if (!verified) return corsResponse({ error: 'Invalid or expired ticket' }, 403);
    mid = verified.manifestId;
  } else if (accessToken) {
    const verified = await verifyTokenSignature(secret, accessToken);
    if (!verified) return corsResponse({ error: 'Invalid or expired access token' }, 403);
    mid = verified.manifestId;
  }

  // ── 4. Find manifest ───────────────────────────────
  const query = mid
    ? `id=eq.${mid}&select=id,master_key`
    : `lesson_id=eq.${lessonId}&select=id,master_key`;
  const manifests = await supabaseGet('video_manifests', query, env);
  if (!manifests || manifests.length === 0) {
    return corsResponse({ error: 'not found' }, 404);
  }

  const manifest = manifests[0];

  // ── 5. Enrollment check ────────────────────────────
  const enrolled = await checkEnrollment(userId, lessonId, env);
  if (!enrolled) {
    return corsResponse({ error: 'Access denied: not enrolled' }, 403);
  }

  // ── 6. Derive key ─────────────────────────────────
  // Must match deriveKey() used in upload.js for new uploads.
  let keyBytes;
  if (env.MASTER_SECRET && !manifest.master_key) {
    // Path A: New uploads — match upload.js deriveKey(MASTER_SECRET, manifestId)
    keyBytes = await deriveKey(env.MASTER_SECRET, String(manifest.id));
  } else if (manifest.master_key) {
    // Path B: Legacy uploads — master_key stored as hex by old upload code
    keyBytes = hexToBytes(manifest.master_key);
  } else {
    return corsResponse({ error: 'Server misconfiguration: no key source' }, 500);
  }

  // ── 7. Wrap key with session-bound JWT hash ───────────
  const wrapEncoder = new TextEncoder();
  const jwtHash = await crypto.subtle.digest('SHA-256', wrapEncoder.encode(token));
  const wrapKeyArr = new Uint8Array(jwtHash);
  const wrappedKey = new Uint8Array(keyBytes.length);
  for (let i = 0; i < keyBytes.length; i++) wrappedKey[i] = keyBytes[i] ^ wrapKeyArr[i];

  // ── 8. Log access (non-blocking) ───────────────────
  context.waitUntil(logKeyAccess(userId, manifest.id, request, env));

  // ── 9. Return wrapped key bytes ────────────────────
  return new Response(wrappedKey, {
    headers: mergeHeaders(CORS_HEADERS, SECURITY_HEADERS, {
      'Content-Type': 'application/octet-stream',
    }),
  });
}

async function logKeyAccess(userId, manifestId, request, env) {
  try {
    const svc = env.SUPABASE_SERVICE_KEY;
    const sb = env.SUPABASE_URL.replace(/\/+$/, '');
    const cf = request.cf || {};
    await fetch(`${sb}/rest/v1/video_access_log`, {
      method: 'POST',
      headers: {
        'apikey': svc, 'Authorization': `Bearer ${svc}`,
        'Content-Type': 'application/json', 'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        user_id: userId,
        manifest_id: manifestId,
        action: 'key_access',
        ip_address: getClientIp(request),
        user_agent: request.headers.get('User-Agent') || '',
      }),
    });
  } catch {
    // silent — logging must never block playback
  }
}
