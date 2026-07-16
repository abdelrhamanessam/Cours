export async function onRequest(context) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };
  if (context.request.method === 'OPTIONS') return new Response(null, { headers: cors });

  // Check what's in the database
  const tables = ['video_manifests', 'mega_segments'];
  const results = {};
  const { env } = context;
  const sbUrl = env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_KEY;

  for (const table of tables) {
    try {
      const r = await fetch(`${sbUrl}/rest/v1/${table}?select=*&limit=10`, {
        headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
      });
      results[table] = { status: r.status, data: await r.json() };
    } catch (e) {
      results[table] = { error: e.message };
    }
  }
  
  return new Response(JSON.stringify(results, null, 2), { 
    status: 200, 
    headers: { ...cors, 'Content-Type': 'application/json' } 
  });
}
