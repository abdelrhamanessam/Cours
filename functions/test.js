export async function onRequest(context) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };
  if (context.request.method === 'OPTIONS') return new Response(null, { headers: cors });
  const { env } = context;
  const sbUrl = env.SUPABASE_URL.replace(/\/+$/, '');
  const sk = env.SUPABASE_SERVICE_KEY;

  const [mani, seg] = await Promise.all([
    fetch(`${sbUrl}/rest/v1/video_manifests?select=*&lesson_id=eq.1&limit=5`, {
      headers: { apikey: sk, Authorization: `Bearer ${sk}` }
    }).then(r => r.json()),
    fetch(`${sbUrl}/rest/v1/mega_segments?select=*&limit=5`, {
      headers: { apikey: sk, Authorization: `Bearer ${sk}` }
    }).then(r => r.json()),
  ]);

  return new Response(JSON.stringify({ mani, seg }, null, 2), {
    status: 200, headers: { ...cors, 'Content-Type': 'application/json' }
  });
}
