// /api/key/:lessonId
// Returns a session-bound decryption key (never the master key)
// Authorization chain: JWT → enrollment → rate limit → derive

import {
  CORS_HEADERS, handleOptions, corsResponse, mergeHeaders, SECURITY_HEADERS,
  verifyUser, checkEnrollment, supabaseGet, checkRateLimit,
  verifyTokenSignature, deriveSessionKey,
  parseAuthToken, getClientIp, generateNonce,
} from './_shared.js';

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

  // ── 6. Derive session-bound key ────────────────────
  // NEVER return the raw master key.
  // Derive a key scoped to (user, session, day).
  // This key is only useful for decrypting segments for this user today.
  const sessionId = generateNonce();
  let keyBytes;
  if (env.MASTER_SECRET && !manifest.master_key) {
    // Path A: Derive from MASTER_SECRET (current upload.js)
    keyBytes = await deriveSessionKey(
      env.MASTER_SECRET, String(manifest.id), userId, sessionId
    );
  } else if (manifest.master_key) {
    // Path B: Derive from stored master_key (legacy uploads)
    // Still returns a session-bound derived key, not the raw master_key
    keyBytes = await deriveSessionKey(
      manifest.master_key, String(manifest.id), userId, sessionId
    );
  } else {
    return corsResponse({ error: 'Server misconfiguration: no key source' }, 500);
  }

  // ── 7. Log access (non-blocking) ───────────────────
  context.waitUntil(logKeyAccess(userId, manifest.id, request, env));

  // ── 8. Return session key ──────────────────────────
  // NOTE: The browser still receives raw key bytes, but these are
  // SESSION-BOUND DERIVED keys, not the master AES key.
  // They are scoped to (manifestId + userId + sessionId + date).
  // An attacker who extracts this key can only decrypt segments
  // for this specific user+session+day combo.
  // SessionId is included in the response so the client can
  // use it for additional verification if needed.
  const extraHeaders = {
    'Content-Type': 'application/octet-stream',
    'X-Session-Id': sessionId,
  };
  return new Response(keyBytes, {
    headers: mergeHeaders(CORS_HEADERS, SECURITY_HEADERS, extraHeaders),
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
