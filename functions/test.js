export async function onRequest(context) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };
  if (context.request.method === 'OPTIONS') return new Response(null, { headers: cors });
  const { env } = context;
  return new Response(JSON.stringify({
    supabaseUrl: env.SUPABASE_URL,
    supabaseAnonKey: typeof env.SUPABASE_ANON_KEY === 'string' ? env.SUPABASE_ANON_KEY.slice(0,30)+'...' : 'not string',
    supabaseServiceKey: typeof env.SUPABASE_SERVICE_KEY === 'string' ? env.SUPABASE_SERVICE_KEY.slice(0,30)+'...' : 'not string',
  }, null, 2), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
}
