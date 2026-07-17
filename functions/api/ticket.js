// POST /api/ticket?mid=MANIFEST_ID
// Creates a short-lived access ticket (60s) with session binding
// Includes: userId, manifestId, sessionId, nonce, client IP, HMAC-SHA256

import {
  CORS_HEADERS, handleOptions, corsResponse, mergeHeaders, SECURITY_HEADERS,
  verifyUser, checkRateLimit, parseAuthToken, getClientIp, generateNonce,
} from './_shared.js';

const TICKET_TTL_MS = 60 * 1000; // 60 seconds

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

  const userId = user.id || user.sub;

  if (!checkRateLimit('ticket:' + userId, 30, 60000)) {
    return corsResponse({ error: 'Too many requests' }, 429);
  }

  const url = new URL(request.url);
  const mid = url.searchParams.get('mid');
  if (!mid) return corsResponse({ error: 'Missing mid' }, 400);

  const secret = env.MASTER_SECRET;
  if (!secret) return corsResponse({ error: 'Server misconfiguration' }, 500);

  try {
    const sessionId = generateNonce();
    const nonce = generateNonce();
    const clientIp = getClientIp(request);
    const expiresAt = Date.now() + TICKET_TTL_MS;

    // Payload includes user + manifest + session + ip binding
    const payload = `${mid}:${userId}:${sessionId}:${expiresAt}:${nonce}:${clientIp}`;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    const sigHex = Array.from(new Uint8Array(sig))
      .map(b => b.toString(16).padStart(2, '0')).join('');

    const encoder2 = new TextEncoder();
    const ticketBytes = encoder2.encode(payload + ':' + sigHex);
    const ticket = Array.from(new Uint8Array(ticketBytes))
      .map(b => b.toString(16).padStart(2, '0')).join('');

    return corsResponse({
      ticket,
      manifestId: mid,
      expiresAt,
      userId,
      sessionId,
    });

  } catch (e) {
    return corsResponse({ error: e.message }, 500);
  }
}
