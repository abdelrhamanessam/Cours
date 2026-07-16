const M = require('megajs');
const c = new M({
  email: 'achbalmaser@gmail.com',
  password: 'REMOVED_PASSWORD',
  userAgent: 'Mozilla/5.0'
});
c.on('ready', () => { console.log('OK'); process.exit(0); });
c.on('error', e => { console.log('ERR:' + e.message); process.exit(1); });
