const { Client } = require('pg');
const c = JSON.parse(require('fs').readFileSync('scripts/config.json', 'utf8'));
const ref = c.supabase_url.match(/https:\/\/([^.]+)/)[1];

async function main() {
  const client = new Client({
    host: 'aws-0-us-east-1.pooler.supabase.com',
    port: 6543,
    database: 'postgres',
    user: 'postgres.' + ref,
    password: c.supabase_service_key,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000
  });

  await client.connect();
  console.log('Connected!');

  await client.query(`ALTER TABLE video_manifests ADD COLUMN IF NOT EXISTS name text DEFAULT ''`);
  console.log('Column added');

  const res = await client.query(`UPDATE video_manifests vm SET name = COALESCE((SELECT ms.file_name FROM mega_segments ms WHERE ms.manifest_id = vm.id ORDER BY ms.segment_num LIMIT 1), vm.id::text) WHERE vm.name IS NULL OR vm.name = ''`);
  console.log('Backfilled:', res.rowCount, 'rows');

  await client.end();
  console.log('Done');
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
