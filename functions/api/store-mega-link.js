// POST /api/store-mega-link
// Stores a Mega.nz link for a video segment after browser-side upload
// Admin-only: requires valid JWT + admin role

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
  if (!isAdmin) return corsResponse({ error: 'Forbidden: admin only' }, 403);

  try {
    const { manifestId, segmentNum, megaLink, name } = await request.json();
    if (!manifestId || segmentNum === undefined || !megaLink) {
      return corsResponse({
        error: 'Missing manifestId, segmentNum, or megaLink',
      }, 400);
    }

    const svc = env.SUPABASE_SERVICE_KEY;
    const sbUrl = env.SUPABASE_URL.replace(/\/+$/, '');
    const q = `manifest_id=eq.${manifestId}&segment_num=eq.${segmentNum}`;
    const updateBody = name && segmentNum === 0
      ? { mega_link: megaLink, file_name: name }
      : { mega_link: megaLink };

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
        error: 'DB update failed', detail: await res.text(),
      }, 500);
    }

    return corsResponse({ ok: true });

  } catch (e) {
    return corsResponse({ error: e.message }, 500);
  }
}
