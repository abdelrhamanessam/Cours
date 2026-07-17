// Test Mega connectivity.
// Usage: MEGA_EMAIL=your_email MEGA_PASSWORD=your_password node scripts/test-mega.js
const M = require('megajs');
const email = process.env.MEGA_EMAIL;
const password = process.env.MEGA_PASSWORD;
if (!email || !password) {
  console.log('Set MEGA_EMAIL and MEGA_PASSWORD env vars');
  process.exit(1);
}
const c = new M({ email, password, userAgent: 'Mozilla/5.0' });
c.on('ready', () => { console.log('OK'); process.exit(0); });
c.on('error', e => { console.log('ERR:' + e.message); process.exit(1); });
