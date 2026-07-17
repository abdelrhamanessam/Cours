const c = JSON.parse(require('fs').readFileSync('scripts/config.json','utf8'));
const base = c.supabase_url;
const sql = "ALTER TABLE video_manifests ADD COLUMN IF NOT EXISTS name text DEFAULT ''";
const headers = {
  'Content-Type': 'application/json',
  apikey: c.supabase_service_key,
  Authorization: 'Bearer ' + c.supabase_service_key
};

async function test(path) {
  try {
    const r = await fetch(base + path, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ query: sql })
    });
    console.log(path, r.status, (await r.text()).slice(0, 200));
  } catch (e) {
    console.log(path, 'ERR', e.message.slice(0, 100));
  }
}

async function main() {
  await test('/pgmeta/v0/query');
  await test('/pgmeta/query');
  await test('/rest/v1/query');
  await test('/rest/v1/sql');
  await test('/auth/v1/sql');
}

main();
