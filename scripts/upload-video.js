const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

const MEGA = require('megajs');

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

async function getMegaClient(account) {
  return new Promise((res, rej) => {
    const client = new MEGA({ email: account.email, password: account.password });
    client.on('error', rej);
    client.on('ready', () => res(client));
  });
}

async function ensureFolder(client, folderPath) {
  const parts = folderPath.split('/').filter(Boolean);
  let current = client.root;
  for (const part of parts) {
    let found = null;
    for (const child of Object.values(current.children)) {
      if (child && child.name === part && child.directory) { found = child; break; }
    }
    if (!found) found = await client.mkdir({ name: part, parent: current });
    current = found;
  }
  return current;
}

async function uploadToMega(client, filePath, fileName, folderNode) {
  return new Promise((res, rej) => {
    const rs = fs.createReadStream(filePath);
    const upload = client.upload({ name: fileName, size: fs.statSync(filePath).size }, rs);
    upload.on('complete', (file) => {
      const link = `https://mega.nz/file/${file.hash}`;
      res(link);
    });
    upload.on('error', rej);
  });
}

async function main() {
  console.log('=== Mr Maths Video Uploader ===\n');

  const masterKey = crypto.randomBytes(32);
  const masterKeyHex = masterKey.toString('hex');
  console.log('Generated master key:', masterKeyHex.slice(0, 16) + '...');

  console.log('Splitting video with FFmpeg...');
  const tmpDir = path.join(__dirname, '..', 'temp_segments_' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });
  const segmentPattern = path.join(tmpDir, 'seg_%03d.ts');
  execSync(`ffmpeg -i "${videoPath}" -c copy -map 0 -segment_time 10 -f segment "${segmentPattern}" -loglevel error`);
  const segmentFiles = fs.readdirSync(tmpDir).filter(f => f.endsWith('.ts')).sort();
  console.log(`Created ${segmentFiles.length} segments\n`);

  console.log('Connecting to MEGA accounts...');
  const megaClients = [];
  for (const acct of config.mega_accounts) {
    const client = await getMegaClient(acct);
    megaClients.push(client);
    console.log(`  Connected: ${acct.email}`);
  }

  console.log('\nCreating folder structure on MEGA...');
  const megaPath = `MrMaths/Course_${courseId}/Lesson_${lessonId}`;
  const folders = [];
  for (const client of megaClients) {
    const folder = await ensureFolder(client, megaPath);
    folders.push(folder);
  }
  console.log(`  Folder: ${megaPath}`);

  console.log('\nEncrypting and uploading segments...');
  const segments = [];
  const segsPerAcct = config.segments_per_account || 6;

  for (let i = 0; i < segmentFiles.length; i++) {
    const segFile = segmentFiles[i];
    const segPath = path.join(tmpDir, segFile);
    const data = fs.readFileSync(segPath);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const encData = Buffer.concat([iv, encrypted, authTag]);

    const acctIndex = Math.floor(i / segsPerAcct) % megaClients.length;
    const encFileName = `seg_${String(i + 1).padStart(3, '0')}.enc`;
    const encPath = path.join(tmpDir, encFileName);
    fs.writeFileSync(encPath, encData);

    console.log(`  [${i + 1}/${segmentFiles.length}] Uploading ${encFileName} → Account ${acctIndex + 1}`);
    const megaLink = await uploadToMega(megaClients[acctIndex], encPath, encFileName, folders[acctIndex]);

    segments.push({
      segment_num: i + 1,
      account_index: acctIndex + 1,
      file_name: encFileName,
      iv: iv.toString('hex'),
      mega_link: megaLink
    });

    fs.unlinkSync(encPath);
  }

  console.log('\nSaving to Supabase...');
  const manifestId = crypto.randomUUID();
  const { error: maniErr } = await sb.from('video_manifests').insert({
    id: manifestId,
    course_id: courseId,
    lesson_id: lessonId,
    master_key: masterKeyHex,
    total_segments: segments.length,
    segment_duration: 10,
    created_at: new Date().toISOString()
  });
  if (maniErr) { console.error('Supabase error (manifest):', maniErr); process.exit(1); }

  for (const seg of segments) {
    const { error: segErr } = await sb.from('mega_segments').insert({
      manifest_id: manifestId,
      segment_num: seg.segment_num,
      account_index: seg.account_index,
      file_name: seg.file_name,
      iv: seg.iv,
      mega_link: seg.mega_link
    });
    if (segErr) console.error('Supabase error (segment):', segErr);
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log('\n=== Done! ===');
  console.log(`Uploaded ${segments.length} segments`);
  console.log(`Video ready for course ${courseId}, lesson ${lessonId}`);
  console.log(`Manifest ID: ${manifestId}`);
}

main().catch(err => { console.error('Error:', err); process.exit(1); });
