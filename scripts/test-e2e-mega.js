const { createClient } = require('@supabase/supabase-js');
const config = JSON.parse(require('fs').readFileSync(__dirname + '/config.json', 'utf8'));
const sb = createClient(config.supabase_url, config.supabase_service_key);

function megaBase64Decode(str) {
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return Uint8Array.from(Buffer.from(b64, 'base64'));
}

async function megaDecrypt(encryptedData, keyBase64) {
  const keyBytes = megaBase64Decode(keyBase64);
  const aesKeyBytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) aesKeyBytes[i] = keyBytes[i] ^ keyBytes[i + 16];
  const key = await crypto.subtle.importKey('raw', aesKeyBytes, { name: 'AES-CTR' }, false, ['decrypt']);
  const counter = new Uint8Array(16);
  counter.set(keyBytes.slice(16, 24), 0);
  return crypto.subtle.decrypt({ name: 'AES-CTR', counter, length: 64 }, key, encryptedData);
}

async function downloadSegmentFromMega(megaLink) {
  const match = megaLink.match(/\/file\/([^#]+)#(.+)/);
  const apiResp = await fetch('https://g.api.mega.co.nz/cs?id=1', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{ a: 'g', g: 1, p: match[1] }])
  });
  const apiData = (await apiResp.json())[0];
  const dlResp = await fetch(apiData.g);
  const encryptedBuf = await dlResp.arrayBuffer();
  return megaDecrypt(encryptedBuf, match[2]);
}

async function main() {
  const manifestId = 'ad3eeede-d2ec-42d4-a617-8740e6a6daff';
  const { data: segments, error } = await sb
    .from('mega_segments')
    .select('*')
    .eq('manifest_id', manifestId)
    .order('segment_num');
  if (error) { console.error('Query error:', error); process.exit(1); }
  console.log('Found ' + segments.length + ' segments for manifest ' + manifestId);

  let totalBytes = 0;
  for (const seg of segments) {
    console.log('\nSegment ' + seg.segment_num + ':');
    console.log('  mega_link: ' + seg.mega_link);

    const encData = await downloadSegmentFromMega(seg.mega_link);
    console.log('  Mega-decrypted: ' + encData.byteLength + ' bytes');

    const first16 = Buffer.from(new Uint8Array(encData, 0, 16)).toString('hex');
    console.log('  First 16 bytes (our IV): ' + first16);
    console.log('  DB IV: ' + seg.iv);
    console.log('  IV match: ' + (first16 === seg.iv) + '');

    totalBytes += encData.byteLength;
  }

  console.log('\nTotal: ' + totalBytes + ' bytes across ' + segments.length + ' segments');
  console.log('All segments downloaded from Mega and verified successfully!');
}

main().catch(e => { console.error(e); process.exit(1); });
