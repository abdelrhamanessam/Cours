const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const Mega = require('megajs');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const sb = createClient(config.supabase_url, config.supabase_service_key);

function megaLogin(account) {
  return new Promise((resolve, reject) => {
    const s = new Mega({ email: account.email, password: account.password, userAgent: 'Mozilla/5.0' });
    s.on('ready', () => resolve(s));
    s.on('error', reject);
  });
}

// Support --manifest flag for single manifest sync
const args = {};
process.argv.slice(2).forEach((a, i, arr) => {
  if (a.startsWith('--')) args[a.slice(2)] = arr[i + 1];
});

async function main() {
  let query = sb.from('mega_segments').select('*');
  if (args.manifest) {
    console.log(`Syncing manifest: ${args.manifest}`);
    query = query.eq('manifest_id', args.manifest);
  }
  query = query.or('mega_link.is.null,mega_link.eq."",mega_link.like.*supabase.co*');
  const { data: segments, error } = await query;
  if (error) { console.error('Query error:', error); process.exit(1); }
  if (!segments || segments.length === 0) {
    console.log('All segments already migrated!');
    process.exit(0);
  }
  console.log(`Found ${segments.length} segments to migrate\n`);

  const account = config.mega_accounts[0];
  const storage = await megaLogin(account);
  console.log('Logged in to Mega\n');

  for (const seg of segments) {
    console.log(`[${seg.manifest_id.slice(0,8)} seg ${seg.segment_num}] Downloading from Supabase...`);
    const { data: fileData, error: dlError } = await sb.storage
      .from('encrypted-videos')
      .download(seg.file_name);
    if (dlError) { console.error(`  Download error:`, dlError); continue; }
    const buffer = Buffer.from(await fileData.arrayBuffer());
    console.log(`  ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);

    const fileName = seg.file_name.replace(/[\\\/]/g, '_');
    console.log(`  Uploading to Mega as "${fileName}"...`);
    const file = await storage.upload({ name: fileName }, buffer).complete;

    const link = await file.link();
    console.log(`  Mega link: ${link}`);

    const { error: upErr } = await sb
      .from('mega_segments')
      .update({ mega_link: link })
      .eq('id', seg.id);
    if (upErr) { console.error('  DB update error:', upErr); continue; }
    console.log('  Done\n');
  }

  console.log('Migration complete!');
}

main().catch(e => { console.error(e); process.exit(1); });
