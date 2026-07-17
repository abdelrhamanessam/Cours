const fs = require('fs');
['index.html', 'admin.html'].forEach(f => {
  try {
    const c = fs.readFileSync(f, 'utf8');
    const m = c.match(/https?:\/\/[^"')]+/g);
    if (m) {
      const filtered = m.filter(u => !u.includes('supabase') && !u.includes('fonts.gstatic'));
      console.log(f + ':', filtered.slice(0, 5));
    }
  } catch (e) {
    // skip
  }
});
