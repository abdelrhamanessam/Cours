// Shared utilities for Mr Maths API functions
// All functions import from here to avoid duplication

// ── CORS ──────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-CSRF-Token',
  'Access-Control-Max-Age': '86400',
};

const SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), fullscreen=(self)',
};

function mergeHeaders(...headerSets) {
  return Object.assign({}, ...headerSets);
}

function corsResponse(body, status = 200, extraHeaders = {}) {
  return new Response(
    typeof body === 'string' ? body : JSON.stringify(body),
    {
      status,
      headers: mergeHeaders(CORS_HEADERS, SECURITY_HEADERS, extraHeaders, {
        'Content-Type': typeof body === 'string' && !body.startsWith('{')
          ? 'text/plain' : 'application/json',
      }),
    }
  );
}

function handleOptions(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: mergeHeaders(CORS_HEADERS, SECURITY_HEADERS),
    });
  }
  return null;
}

// ── Authentication ────────────────────────────────────
async function verifyUser(token, env) {
  if (!token) return null;
  try {
    const r = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/user`, {
      headers: {
        'apikey': env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${token}`,
      },
    });
    if (!r.ok) return null;
    return r.json();
  } catch {
    return null;
  }
}

async function checkAdmin(user, env) {
  if (!user) return false;
  try {
    const sbUrl = env.SUPABASE_URL.replace(/\/+$/, '');
    const svc = env.SUPABASE_SERVICE_KEY;
    const r = await fetch(`${sbUrl}/rest/v1/profiles?id=eq.${user.id}&select=role`, {
      headers: { 'apikey': svc, 'Authorization': `Bearer ${svc}` },
    });
    if (!r.ok) return false;
    const profiles = await r.json();
    return profiles && profiles.length > 0 && profiles[0].role === 'admin';
  } catch {
    return false;
  }
}

// Note: Enrollment verification is a placeholder.
// The actual enrollment/subscription logic depends on your business model.
// Adjust the table name and query to match your schema.
async function checkEnrollment(userId, lessonId, env) {
  if (!userId) return false;
  if (!lessonId) return true; // No lessonId bound — access gated by manifest/key endpoints
  try {
    // TODO: Replace with your actual enrollment/subscription check
    // Example: Check if user purchased the course containing this lesson
    // const enrollments = await supabaseGet('enrollments',
    //   `user_id=eq.${userId}&course_id=eq.${courseId}&status=eq.active`,
    //   env
    // );
    // return enrollments && enrollments.length > 0;
    return true; // TEMP: Allow all authenticated users
  } catch {
    return false;
  }
}

// ── Supabase queries ──────────────────────────────────
function sbUrl(env) {
  return env.SUPABASE_URL.replace(/\/+$/, '');
}

async function supabaseGet(table, query, env) {
  try {
    const r = await fetch(`${sbUrl(env)}/rest/v1/${table}?${query}`, {
      headers: {
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
    });
    if (!r.ok) return null;
    return r.json();
  } catch {
    return null;
  }
}

// ── Rate Limiting (in-memory, best-effort) ────────────
// For production, use Cloudflare Rate Limiting or Durable Objects
const rateLimitStore = {};

function checkRateLimit(key, limit = 30, windowMs = 60000) {
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

// ── Ticket / Access Token Verification ────────────────
async function verifyTokenSignature(secret, token) {
  if (!token || typeof token !== 'string') return null;
  const tokenLen = token.length;

  // Decode: try hex first, fall back to base64
  let decoded;
  const isHex = /^[0-9a-fA-F]+$/.test(token);
  if (isHex) {
    try {
      const bytes = new Uint8Array(
        token.match(/.{1,2}/g).map(b => parseInt(b, 16))
      );
      decoded = new TextDecoder().decode(bytes);
    } catch { return null; }
  } else {
    // May not be hex — likely a trailing-equals base64. Decode via atob.
    try { decoded = atob(token); } catch { return null; }
  }

  try {
    const lastColon = decoded.lastIndexOf(':');
    const data = decoded.substring(0, lastColon);
    const sigHex = decoded.substring(lastColon + 1);
    const parts = data.split(':');
    if (parts.length < 4) return null;
    const manifestId = parts[0];
    const userId = parts[1];
    const expiresAt = parseInt(parts[3]);
    if (Date.now() > expiresAt) return null;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const sigBytes = new Uint8Array(
      sigHex.match(/.{1,2}/g).map(b => parseInt(b, 16))
    );
    const valid = await crypto.subtle.verify(
      'HMAC', key, sigBytes, encoder.encode(data)
    );
    return valid ? { manifestId, userId, parts } : null;
  } catch (e) {
    console.error('verifyTokenSignature error:', e);
    return null;
  }
}

// ── Key Derivation ────────────────────────────────────
async function deriveKey(secret, manifestId) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), 'HKDF', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF', hash: 'SHA-256',
      salt: encoder.encode('mr-maths-video-key-v1'),
      info: encoder.encode(manifestId),
    },
    keyMaterial, 256
  );
  return new Uint8Array(bits);
}

// Derive a session-bound key from the master key + context
// This ensures the key is specific to (user, day) and cannot be reused
async function deriveSessionKey(secret, manifestId, userId, sessionId) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), 'HKDF', false, ['deriveBits']
  );
  const today = new Date().toISOString().slice(0, 10);
  const info = `${manifestId}:${userId}:${sessionId || ''}:${today}`;
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF', hash: 'SHA-256',
      salt: encoder.encode('mr-maths-session-key-v2'),
      info: encoder.encode(info),
    },
    keyMaterial, 256
  );
  return new Uint8Array(bits);
}

// ── Helpers ───────────────────────────────────────────
function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    b[i >> 1] = parseInt(hex.substr(i, 2), 16);
  }
  return b;
}

function parseAuthToken(request) {
  return request.headers.get('Authorization')?.slice(7) || null;
}

function getClientIp(request) {
  return request.headers.get('CF-Connecting-IP')
    || request.headers.get('X-Forwarded-For')
    || 'unknown';
}

function generateNonce() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return bytesToHex(b);
}

export {
  CORS_HEADERS,
  SECURITY_HEADERS,
  mergeHeaders,
  corsResponse,
  handleOptions,
  verifyUser,
  checkAdmin,
  checkEnrollment,
  sbUrl,
  supabaseGet,
  checkRateLimit,
  verifyTokenSignature,
  deriveKey,
  deriveSessionKey,
  bytesToHex,
  hexToBytes,
  parseAuthToken,
  getClientIp,
  generateNonce,
};
