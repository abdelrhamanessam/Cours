// Usage: MEGA_EMAIL=your_email MEGA_PASSWORD=your_password node scripts/test-mega-props.js
const M = require('megajs');
const email = process.env.MEGA_EMAIL;
const password = process.env.MEGA_PASSWORD;
if (!email || !password) {
  console.log('Set MEGA_EMAIL and MEGA_PASSWORD env vars');
  process.exit(1);
}
const c = new M({ email, password });
c.on('ready', async () => {
  try {
    // Create a test file
    const buf = Buffer.from('test');
    const up = c.upload({ name: 'test_props.txt', size: buf.length });
    up.on('complete', f => {
      console.log('Keys:', Object.keys(f));
      console.log('hash:', f.hash);
      console.log('nodeId:', f.nodeId);
      console.log('name:', f.name);
      process.exit();
    });
    up.on('error', e => { console.log('Upload error:', e.message); process.exit(1); });
    up.write(buf);
    up.end();
  } catch(e) { console.log('Error:', e.message); process.exit(1); }
});
c.on('error', e => { console.log('Auth error:', e.message); process.exit(1); });
