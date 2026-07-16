// Cloudflare Pages Function — handles /api/manifest and /api/key
// Environment variables (set in Cloudflare Pages Dashboard):
// SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY

export async function onRequest(context) {
  const { request, env, params } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  };

  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

  const token = request.headers.get('Authorization')?.slice(7);
  if (!token) return new Response('Unauthorized', { status: 401, headers: cors });

  const user = await verifyUser(token, env);
  if (!user) return new Response('Invalid token', { status: 401, headers: cors });

  const matchManifest = path.match(/^\/api\/manifest\/(\d+)$/);
  if (matchManifest) return handleManifest(matchManifest[1], env, cors);

  const matchKey = path.match(/^\/api\/key\/(\d+)$/);
  if (matchKey) return handleKey(parseInt(matchKey[1]), user.id, env, cors);

  return new Response('Not found', { status: 404, headers: cors });
}

async function supabaseGet(table, query, env) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!res.ok) return null;
  return res.json();
}

async function verifyUser(token, env) {
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'apikey': env.SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${token}`,
    },
  });
  if (!res.ok) return null;
  return res.json();
}

async function handleManifest(lessonId, env, cors) {
  const manifests = await supabaseGet('video_manifests',
    `lesson_id=eq.${lessonId}&select=id,total_segments,segment_duration`,
    env
  );
  if (!manifests || manifests.length === 0) {
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: cors });
  }
  const m = manifests[0];
  const segments = await supabaseGet('mega_segments',
    `manifest_id=eq.${m.id}&select=segment_num,mega_link,iv,file_name&order=segment_num.asc`,
    env
  );
  return new Response(JSON.stringify({
    manifestId: m.id,
    totalSegments: m.total_segments,
    segmentDuration: m.segment_duration,
    segments: segments || [],
  }), { headers: { ...cors, 'Content-Type': 'application/json' } });
}

async function handleKey(lessonId, userId, env, cors) {
  const manifests = await supabaseGet('video_manifests',
    `lesson_id=eq.${lessonId}&select=id,master_key`,
    env
  );
  if (!manifests || manifests.length === 0) {
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: cors });
  }
  const m = manifests[0];

  const key = hexToBytes(m.master_key);
  return new Response(key, {
    headers: { ...cors, 'Content-Type': 'application/octet-stream' },
  });
}

function hexToBytes(hex) {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) b[i >> 1] = parseInt(hex.substr(i, 2), 16);
  return b;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
