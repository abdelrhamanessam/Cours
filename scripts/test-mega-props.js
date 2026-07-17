const M = require('megajs');
const c = new M({email:'achbalmaser@gmail.com',password:'REMOVED_PASSWORD'});
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
