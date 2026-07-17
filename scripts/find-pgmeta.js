const c = JSON.parse(require('fs').readFileSync('scripts/config.json','utf8'));
const base = c.supabase_url;
const headers = {
  'Content-Type': 'application/json',
  apikey: c.supabase_service_key,
  Authorization: 'Bearer ' + c.supabase_service_key
};

const endpoints = [
  '/pgmeta/v0/query',
  '/pgmeta/v0/queries',
  '/v1/pgmeta/query',
  '/api/pgmeta/query',
  '/pgmeta/query',
  '/rest/v1/pgmeta',
  '/auth/v1/admin/pgmeta',
  '/storage/v1/pgmeta',
  '/api/v1/pgmeta/query',
];

async function testAll() {
  for (const path of endpoints) {
    try {
      const r = await fetch(base + path, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: 'SELECT 1' })
      });
      const text = (await r.text()).slice(0, 100);
      console.log(r.status, path, '->', text);
    } catch (e) {
      console.log('ERR', path, '->', e.message.slice(0, 80));
    }
  }
}

testAll();
