// POST /api/access-token
// Creates a short-lived access token (5 min) from a valid ticket
// The token includes: manifestId, userId, sessionId, client IP

import {
  CORS_HEADERS, handleOptions, corsResponse,
  verifyUser, checkRateLimit, verifyTokenSignature,
  parseAuthToken, getClientIp, generateNonce,
} from './_shared.js';

const ACCESS_TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

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

  if (!checkRateLimit('access-token:' + userId, 30, 60000)) {
    return corsResponse({ error: 'Too many requests' }, 429);
  }

  try {
    const body = await request.json();
    const pageTicket = body.ticket;
    if (!pageTicket) return corsResponse({ error: 'Missing ticket' }, 400);

    const secret = env.MASTER_SECRET;
    if (!secret) return corsResponse({ error: 'Server misconfiguration' }, 500);

    // Verify the incoming ticket
    const verified = await verifyTokenSignature(secret, pageTicket);
    if (!verified) {
      return corsResponse({ error: 'Invalid or expired ticket' }, 403);
    }

    // Additional check: ensure the ticket's userId matches the current user
    if (verified.userId !== userId) {
      return corsResponse({ error: 'Ticket belongs to a different user' }, 403);
    }

    // Create short-lived access token
    const sessionId = generateNonce();
    const nonce = generateNonce();
    const clientIp = getClientIp(request);
    const expiresAt = Date.now() + ACCESS_TOKEN_TTL_MS;

    const payload = `${verified.manifestId}:${userId}:${sessionId}:${expiresAt}:${nonce}:${clientIp}`;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    const sigHex = Array.from(new Uint8Array(sig))
      .map(b => b.toString(16).padStart(2, '0')).join('');

    const tokenEncoder = new TextEncoder();
    const atBytes = tokenEncoder.encode(payload + ':' + sigHex);
    const accessToken = Array.from(new Uint8Array(atBytes))
      .map(b => b.toString(16).padStart(2, '0')).join('');

    return corsResponse({
      accessToken,
      manifestId: verified.manifestId,
      expiresAt,
      sessionId,
    });

  } catch (e) {
    return corsResponse({ error: e.message }, 500);
  }
}
