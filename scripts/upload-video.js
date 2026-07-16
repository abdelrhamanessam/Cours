const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const MEGA = require('megajs');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const sb = createClient(config.supabase_url, config.supabase_service_key);

const args = {};
process.argv.slice(2).forEach((a, i, arr) => {
  if (a.startsWith('--')) args[a.slice(2)] = arr[i + 1];
});

if (!args.file || !args.course || !args.lesson) {
  console.log('Usage: node scripts/upload-video.js --file video.mp4 --course 1 --lesson 5');
  process.exit(1);
}

const videoPath = path.resolve(args.file);
const courseId = parseInt(args.course);
const lessonId = parseInt(args.lesson);

function getMegaClient(account) {
  return new Promise((res, rej) => {
    const client = new MEGA({ email: account.email, password: account.password });
    client.on('error', rej);
    client.on('ready', () => res(client));
  });
}

async function ensureFolder(client, folderPath) {
  const parts = folderPath.split('/').filter(Boolean);
  let current = client.root;
  for (const p of parts) {
    let found = null;
    for (const c of Object.values(current.children)) {
      if (c && c.name === p && c.directory) { found = c; break; }
    }
    if (!found) found = await client.mkdir({ name: p, parent: current });
    current = found;
  }
  return current;
}

function uploadToMega(client, filePath, name, folder) {
  return new Promise((res, rej) => {
    const rs = fs.createReadStream(filePath);
    const up = client.upload({ name, size: fs.statSync(filePath).size }, rs);
    up.on('complete', (f) => res(`https://mega.nz/file/${f.hash}`));
    up.on('error', rej);
  });
}

async function main() {
  console.log('=== Mr Maths Video Uploader ===\n');

  const masterKey = crypto.randomBytes(32);
  console.log('Master key:', masterKey.toString('hex').slice(0, 16) + '...');

  console.log('Encrypting video...');
  const videoData = fs.readFileSync(videoPath);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
  const encrypted = Buffer.concat([cipher.update(videoData), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: iv(16) + encrypted + authTag(16)
  const encData = Buffer.concat([iv, encrypted, authTag]);

  const tmpFile = path.join(__dirname, '..', `temp_video_${Date.now()}.enc`);
  fs.writeFileSync(tmpFile, encData);
  const ext = path.extname(videoPath);
  const encName = `lesson_${lessonId}${ext}.enc`;

  console.log('Connecting to MEGA...');
  const accounts = config.mega_accounts;
  const acct = accounts[0];
  const client = await getMegaClient(acct);
  const folder = await ensureFolder(client, `MrMaths/Course_${courseId}/Lesson_${lessonId}`);

  console.log('Uploading encrypted video to MEGA...');
  const megaLink = await uploadToMega(client, tmpFile, encName, folder);
  console.log('Uploaded:', megaLink);

  fs.unlinkSync(tmpFile);

  console.log('\nCleaning old manifest (if any)...');
  const old = await sb.from('video_manifests').select('id').eq('lesson_id', lessonId).maybeSingle();
  if (old.data) {
    await sb.from('mega_segments').delete().eq('manifest_id', old.data.id);
    await sb.from('video_manifests').delete().eq('id', old.data.id);
  }

  console.log('Saving to Supabase...');
  const manifestId = crypto.randomUUID();
  await sb.from('video_manifests').insert({
    id: manifestId, course_id: courseId, lesson_id: lessonId,
    master_key: masterKey.toString('hex'),
    total_segments: 1, segment_duration: 0,
    created_at: new Date().toISOString()
  });
  await sb.from('mega_segments').insert({
    manifest_id: manifestId, segment_num: 1,
    account_index: 1, file_name: encName,
    iv: iv.toString('hex'), mega_link: megaLink
  });

  console.log('\n=== Done! ===');
  console.log('Manifest ID:', manifestId);
}

main().catch(e => { console.error(e); process.exit(1); });
