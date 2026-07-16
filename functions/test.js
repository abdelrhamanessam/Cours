export async function onRequest(context) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };
  const ok = Boolean(context.env.SUPABASE_URL && context.env.SUPABASE_ANON_KEY && context.env.SUPABASE_SERVICE_KEY);
  return new Response(JSON.stringify({
    envOk: ok,
    hasUrl: !!context.env.SUPABASE_URL,
    hasKey: !!context.env.SUPABASE_ANON_KEY,
    hasService: !!context.env.SUPABASE_SERVICE_KEY,
    url: context.env.SUPABASE_URL ? String(context.env.SUPABASE_URL).slice(0,20)+'...' : null,
  }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
}
