const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

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
  const encData = Buffer.concat([iv, encrypted, authTag]);

  const ext = path.extname(videoPath);
  const fileName = `course_${courseId}/lesson_${lessonId}${ext}.enc`;

  console.log('Uploading to Supabase Storage...');
  const { data: upData, error: upErr } = await sb.storage
    .from('encrypted-videos')
    .upload(fileName, encData, { contentType: 'application/octet-stream', upsert: true });
  if (upErr) { console.error('Upload error:', upErr); process.exit(1); }

  const { data: { publicUrl } } = sb.storage.from('encrypted-videos').getPublicUrl(fileName);
  console.log('Uploaded:', publicUrl);

  console.log('\nCleaning old manifest...');
  const old = await sb.from('video_manifests').select('id').eq('lesson_id', lessonId).maybeSingle();
  if (old.data) {
    await sb.from('mega_segments').delete().eq('manifest_id', old.data.id);
    await sb.from('video_manifests').delete().eq('id', old.data.id);
    // Also delete old file from storage
    try {
      const oldMani = await sb.from('video_manifests').select('file_path').eq('lesson_id', lessonId).single();
      if (oldMani.data?.file_path) await sb.storage.from('encrypted-videos').remove([oldMani.data.file_path]);
    } catch(e) {}
  }

  console.log('Saving to Supabase...');
  const manifestId = crypto.randomUUID();
  await sb.from('video_manifests').insert({
    id: manifestId, course_id: courseId, lesson_id: lessonId,
    master_key: masterKey.toString('hex'),
    total_segments: 1, segment_duration: 0,
    file_path: fileName,
    created_at: new Date().toISOString()
  });
  await sb.from('mega_segments').insert({
    manifest_id: manifestId, segment_num: 1,
    account_index: 1, file_name: fileName,
    iv: iv.toString('hex'), mega_link: publicUrl
  });

  console.log('\n=== Done! ===');
  console.log('Manifest ID:', manifestId);
}

main().catch(e => { console.error(e); process.exit(1); });
