// /api/manifest/:lessonId
// Returns segment manifest for a lesson
// mega_link is NEVER exposed to the client — storage is abstracted

import {
  CORS_HEADERS, handleOptions, corsResponse, mergeHeaders, SECURITY_HEADERS,
  verifyUser, checkEnrollment, supabaseGet, checkRateLimit,
  verifyTokenSignature, parseAuthToken,
} from '../_shared.js';

export async function onRequest(context) {
  const { request, env, params } = context;

  const opt = handleOptions(request);
  if (opt) return opt;

  const token = parseAuthToken(request);
  if (!token) return corsResponse({ error: 'Unauthorized' }, 401);

  const user = await verifyUser(token, env);
  if (!user) return corsResponse({ error: 'Invalid token' }, 401);

  const userId = user.id || user.sub;

  if (!checkRateLimit('manifest:' + userId, 30, 60000)) {
    return corsResponse({ error: 'Too many requests' }, 429);
  }

  const lessonId = params.lessonId;
  const url = new URL(request.url);
  let mid = url.searchParams.get('mid');
  const ticket = url.searchParams.get('ticket');

  const secret = env.MASTER_SECRET;
  if (!secret) return corsResponse({ error: 'Server misconfiguration' }, 500);

  if (ticket) {
    const verified = await verifyTokenSignature(secret, ticket);
    if (!verified) return corsResponse({ error: 'Invalid or expired ticket' }, 403);
    mid = verified.manifestId;
  }

  // Enrollment check — when mid is specified, use manifest's lesson_id if available
  const checkLessonId = mid ? null : lessonId;
  const enrolled = await checkEnrollment(userId, checkLessonId, env);
  if (!enrolled) {
    return corsResponse({ error: 'Access denied: not enrolled' }, 403);
  }

  const query = mid
    ? `id=eq.${mid}&select=id,total_segments,segment_duration`
    : `lesson_id=eq.${lessonId}&select=id,total_segments,segment_duration`;
  const manifests = await supabaseGet('video_manifests', query, env);
  if (!manifests || manifests.length === 0) {
    return corsResponse({ error: 'not found' }, 404);
  }

  const m = manifests[0];

  // Get segments but WITHOUT mega_link — storage is server-side only
  const segments = await supabaseGet(
    'mega_segments',
    `manifest_id=eq.${m.id}&select=segment_num,iv,file_name&order=segment_num.asc`,
    env
  );

  // Strip file_name (may contain storage paths) — only send what client needs
  const safeSegments = (segments || []).map(s => ({
    segment_num: s.segment_num,
    iv: s.iv,
  }));

  return corsResponse({
    manifestId: m.id,
    totalSegments: m.total_segments,
    segmentDuration: m.segment_duration,
    segments: safeSegments,
  }, 200, { 'Content-Type': 'application/json' });
}
