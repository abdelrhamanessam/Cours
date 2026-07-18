import {
  CORS_HEADERS, handleOptions, corsResponse,
  verifyUser, checkAdmin, parseAuthToken,
} from './_shared.js';

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
  if (!isAdmin) return corsResponse({ error: 'Forbidden' }, 403);

  try {
    const { action, code } = await request.json();
    const svc = env.SUPABASE_SERVICE_KEY;
    const sbUrl = env.SUPABASE_URL.replace(/\/+$/, '');

    if (action === 'verify') {
      if (!code) return corsResponse({ ok: false }, 400);
      const resp = await fetch(
        `${sbUrl}/rest/v1/admin_config?key=eq.admin_secret_code&select=value`,
        { headers: { 'apikey': svc, 'Authorization': `Bearer ${svc}` } }
      );
      if (!resp.ok) return corsResponse({ ok: false }, 500);
      const rows = await resp.json();
      if (!rows || rows.length === 0) return corsResponse({ ok: true });
      const stored = rows[0].value;
      const inputHash = await sha256Hex(code);
      const ok = stored.length === 64 ? stored === inputHash : code === stored;
      return corsResponse({ ok });
    }

    if (action === 'check') {
      const resp = await fetch(
        `${sbUrl}/rest/v1/admin_config?key=eq.admin_secret_code&select=value`,
        { headers: { 'apikey': svc, 'Authorization': `Bearer ${svc}` } }
      );
      if (!resp.ok) return corsResponse({ exists: false }, 200);
      const rows = await resp.json();
      return corsResponse({ exists: rows && rows.length > 0 && !!rows[0].value });
    }

    if (action === 'set') {
      if (!code) return corsResponse({ error: 'Code required' }, 400);
      const hash = await sha256Hex(code);
      await fetch(`${sbUrl}/rest/v1/admin_config?key=eq.admin_secret_code`, {
        method: 'PATCH',
        headers: {
          'apikey': svc, 'Authorization': `Bearer ${svc}`,
          'Content-Type': 'application/json', 'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ value: hash }),
      });
      return corsResponse({ ok: true });
    }

    if (action === 'clear') {
      await fetch(`${sbUrl}/rest/v1/admin_config?key=eq.admin_secret_code`, {
        method: 'DELETE',
        headers: { 'apikey': svc, 'Authorization': `Bearer ${svc}` },
      });
      return corsResponse({ ok: true });
    }

    return corsResponse({ error: 'Unknown action' }, 400);
  } catch (e) {
    return corsResponse({ error: e.message }, 500);
  }
}

async function sha256Hex(str) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
}
