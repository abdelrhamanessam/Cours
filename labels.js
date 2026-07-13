(function() {
  const TAG_MAP = {
    DIV:'a', SPAN:'b', BUTTON:'c', A:'d',
    H1:'e', H2:'e', H3:'e', H4:'e', H5:'e', H6:'e',
    P:'f', IMG:'g', SECTION:'h', INPUT:'i',
    NAV:'j', HEADER:'k', FOOTER:'l', UL:'m', OL:'m', LI:'n',
    FORM:'o', LABEL:'p', SELECT:'q', TEXTAREA:'r',
    SVG:'s', PATH:'t', BLOCKQUOTE:'u', STRONG:'v', BR:'w'
  };
  let active = false;
  let badges = [];
  const styleId = 'ls-style';

  function getTagLetter(tag) {
    return TAG_MAP[tag] || 'z';
  }

  const counters = {};
  function nextId(tag) {
    const letter = getTagLetter(tag);
    counters[letter] = (counters[letter] || 0) + 1;
    return letter + counters[letter];
  }

  function injectStyles(on) {
    const existing = document.getElementById(styleId);
    if (existing) existing.remove();
    if (!on) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = '.ls-badge{position:absolute;z-index:999999;top:0;left:0;font:700 9px/14px monospace;padding:0 5px;border-radius:0 0 4px 0;color:#fff;background:rgba(0,0,0,.7);pointer-events:none;white-space:nowrap;user-select:none}.ls-tog{position:fixed;z-index:999999;bottom:16px;right:16px;padding:6px 14px;border:2px solid #f59e0b;border-radius:8px;background:#1e293b;color:#f59e0b;font:700 12px/1 system-ui,sans-serif;cursor:pointer;user-select:none;transition:all .15s;box-shadow:0 2px 12px rgba(0,0,0,.3)}.ls-tog.on{background:#f59e0b;color:#1e293b}';
    document.head.appendChild(style);
  }

  function labelElement(el, id) {
    const badge = document.createElement('div');
    badge.className = 'ls-badge';
    badge.textContent = id;
    badge.style.position = 'absolute';
    el.style.position = el.style.position === 'static' || !el.style.position ? 'relative' : el.style.position;
    el.appendChild(badge);
    badges.push(badge);
    return badge;
  }

  function labelVisibleElements() {
    cleanup();
    Object.keys(counters).forEach(k => delete counters[k]);
    const all = document.querySelectorAll('*');
    const walk = [];
    all.forEach(el => {
      if (el.classList && (el.classList.contains('ls-badge') || el.classList.contains('ls-tog'))) return;
      if (el.id === styleId) return;
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'META' || el.tagName === 'LINK') return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return;
      walk.push(el);
    });
    walk.forEach(el => {
      const id = nextId(el.tagName);
      labelElement(el, id);
    });
  }

  function cleanup() {
    badges.forEach(b => b.remove());
    badges = [];
  }

  function toggle() {
    active = !active;
    const btn = document.getElementById('ls-toggle');
    if (active) {
      btn.textContent = 'Labels ON';
      btn.classList.add('on');
      labelVisibleElements();
    } else {
      btn.textContent = 'Labels OFF';
      btn.classList.remove('on');
      cleanup();
    }
  }

  function init() {
    injectStyles(true);
    const btn = document.createElement('div');
    btn.id = 'ls-toggle';
    btn.className = 'ls-tog';
    btn.textContent = 'Labels OFF';
    btn.onclick = toggle;
    document.body.appendChild(btn);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
