const SUPABASE_URL = 'https://usllnkoqqpfynsiprvqh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzbGxua29xcXBmeW5zaXBydnFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3MTYxMzgsImV4cCI6MjA5OTI5MjEzOH0.JbWJo9S7phVksNx8ib8zXY6QkHy-6FpLT-vDedEFp_g';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let userProfile = null;
let COURSES = [];
let Progress = {};
let currentLessonId = null;
let quizState = null;
let _bannedWordsCache = null;

// ── Banned words normalization pipeline ──
var AR_DIACR = /[\u064B-\u065F\u0670]/g;
var AR_MAP = { '\u0623':'\u0627','\u0625':'\u0627','\u0622':'\u0627','\u0621':'','\u0629':'\u0647','\u0649':'\u064A','\u064A':'','\u0624':'\u0648','\u0626':'\u064A' };
var ZW_CHARS = /[\u200B-\u200F\uFEFF\u061C\u2060-\u2064]/g;
var LEET_PATTERNS = [
  [/[3\u20B3]/g,'ع'],[/[7\u20BB]/g,'ح'],[/5/g,'خ'],[/0/g,'o'],[/1/g,'i'],[/4/g,'a'],
  [/8/g,'b'],[/2/g,'z'],[/6/g,'b'],[/9/g,'g'],
  [/\$\$/g,'ss'],[/\|/g,'i'],[/@/g,'a'],[/\u00A9/g,'c']
];
// English letter-to-similar-looking replacements for catching evasion
var ENG_ALIKE = { '0':'o','1':'i','3':'e','4':'a','5':'s','7':'t','8':'b','$':'s','@':'a','!':'i','*':'' };

function normalizeText(str) {
  if (!str) return '';
  var s = String(str);
  // 1. Strip zero-width / invisible Unicode
  s = s.replace(ZW_CHARS, '');
  // 2. Strip Arabic diacritics
  s = s.replace(AR_DIACR, '');
  // 3. Normalize Arabic letters
  var chars = s.split('');
  for (var ci = 0; ci < chars.length; ci++) { var m = AR_MAP[chars[ci]]; if (m !== undefined) { if (m === '') chars[ci] = ''; else chars[ci] = m; } }
  s = chars.join('');
  // 4. Leetspeak / Arabizi number conversion
  for (var pi = 0; pi < LEET_PATTERNS.length; pi++) s = s.replace(LEET_PATTERNS[pi][0], LEET_PATTERNS[pi][1]);
  // 5. Collapse 3+ repeated chars to 2 (Arabic keeps double letters, English reduces to 1)
  s = s.replace(/([^\w])+/g, '$1');
  s = s.replace(/(.)\1{2,}/g, '$1$1');
  // 6. Remove single non-word chars between word letters (catches f.u.c.k evasion)
  s = s.replace(/(\w)[\s.\-_*+,;:!?#\/\\~`'\"(){}\[\]|@$%^&=<>](?=\w)/g, '$1');
  // 7. Lowercase
  s = s.toLowerCase();
  return s;
}

function makeStripped(str) {
  // Remove everything that is not a word character or Arabic letter
  return str.replace(/[^\w\u0600-\u06FF]/g, '');
}

async function ensureBannedCache() {
  if (_bannedWordsCache) return;
  var r = await sb.from('banned_words').select('*');
  var words = r.data || [];
  _bannedWordsCache = words.map(function(w) {
    return { id: w.id, word: w.word, severity: w.severity || 'severe', lang: w.lang || 'en', category: w.category || 'general', norm: normalizeText(w.word), stripped: makeStripped(normalizeText(w.word)) };
  });
}

function checkBannedContent(content) {
  if (!_bannedWordsCache || !content) return [];
  var c = String(content);
  var norm = normalizeText(c);
  var stripped = makeStripped(norm);
  var hits = [];
  for (var i = 0; i < _bannedWordsCache.length; i++) {
    var bw = _bannedWordsCache[i];
    if (norm.indexOf(bw.norm) >= 0 || stripped.indexOf(bw.stripped) >= 0) {
      hits.push({ word: bw.word, severity: bw.severity, lang: bw.lang, category: bw.category });
    }
  }
  return hits;
}
// ── end banned words pipeline ──

initApp();

async function initApp() {
  const { data: { session } } = await sb.auth.getSession();
  currentUser = session?.user || null;
  if (currentUser) {
    await loadUserAndProgress();
    var ok = await checkDeviceLimit();
    if (!ok) { await fetchCourses(); updateAuthUI(); renderProfile(); renderLandingCourses(); showView('landing'); return; }
  }
  await fetchCourses();
  updateAuthUI();
  renderProfile();
  renderLandingCourses();
  showView('landing');
}

async function fetchCourses() {
  const { data } = await sb.from('courses').select('*, lessons:lessons(*, lectures:lectures(*), homework:homework(*, hw_questions:hw_questions(*), hw_image_questions:hw_image_questions(*)), exams:exams(*, exam_questions:exam_questions(*), exam_image_questions:exam_image_questions(*)))').order('sort_order');
  COURSES = (data || []).map(c => ({
    id: c.id, title: c.title, img: c.image_url || '', desc: c.description, icon: c.icon, level: c.level || 'sec1', updated_at: c.updated_at || c.created_at,
    lessons: (c.lessons || []).sort((a,b) => (a.sort_order||0) - (b.sort_order||0)).map(l => ({
      id: l.id, title: l.title, topic: l.topic, desc: l.description,
      شرح: (l.lectures || []).sort((a,b) => (a.sort_order||0) - (b.sort_order||0)).map(lec => ({
        title: lec.title, content: lec.content, math: lec.math, type: lec.type, video_url: lec.video_url || '', file_url: lec.file_url || '', pdf_url: lec.pdf_url || '', image_url: lec.image_url || ''
      })),
      واجب: {
        passScore: l.homework?.pass_score || 60,
        questions: (l.homework?.hw_questions || []).sort((a,b) => (a.sort_order||0) - (b.sort_order||0)).map(q => ({ id: q.id, q: q.question, opts: q.options, correct: q.correct, math: q.math || '', image_url: q.image_url || '', option_images: q.option_images || [], explanation: q.explanation || '', explanation_image_url: q.explanation_image_url || '' })),
        imageQuestions: (l.homework?.hw_image_questions || []).sort((a,b) => (a.sort_order||0) - (b.sort_order||0)).map(q => ({ id: q.id, imgQ: q.image_url, correct: q.correct, explanation: q.explanation || '', explanation_image_url: q.explanation_image_url || '', option_images: q.option_images || [] }))
      },
      امتحان: {
        passScore: l.exams?.pass_score || 60,
        totalQuestions: l.exams?.total_questions || 0,
        maxAttempts: l.exams?.max_attempts || 0,
        attemptPassScore: l.exams?.attempt_pass_score || 60,
        hasFinalExam: l.exams?.has_final_exam || false,
        questionsPerAttempt: l.exams?.questions_per_attempt || 0,
        timeLimit: l.exams?.time_limit_minutes || 20,
        questions: (l.exams?.exam_questions || []).sort((a,b) => (a.sort_order||0) - (b.sort_order||0)).map(q => ({ id: q.id, q: q.question, opts: q.options, correct: q.correct, math: q.math || '', image_url: q.image_url || '', option_images: q.option_images || [], explanation: q.explanation || '', explanation_image_url: q.explanation_image_url || '' })),
        imageQuestions: (l.exams?.exam_image_questions || []).sort((a,b) => (a.sort_order||0) - (b.sort_order||0)).map(q => ({ id: q.id, imgQ: q.image_url, correct: q.correct, explanation: q.explanation || '', explanation_image_url: q.explanation_image_url || '', option_images: q.option_images || [] }))
      }
    }))
  }));
}

function renderLandingCourses() {
  var grid = document.getElementById('landing-courses-grid');
  if (!grid) return;
  var level = userProfile?.level || null;
  var filtered = level ? COURSES.filter(function(c) { return c.level === level; }) : COURSES;
  if (filtered.length === 0) {
    var sec = document.getElementById('landing-courses');
    if (sec) sec.style.display = 'none';
    return;
  }
  grid.innerHTML = filtered.map(function(c) {
    var tot = c.lessons.length;
    var done = c.lessons.filter(function(l) { return Progress[l.id]?.completed; }).length;
    var pct = tot > 0 ? Math.round(done / tot * 100) : 0;
    var lvl = c.level || 'sec1';
    var lvlLabel = lvl.replace('sec','Sec ');
    var thumbKey = 'algebra';
    var t = (c.title + ' ' + (c.desc||'')).toLowerCase();
    if (t.includes('trig') || t.includes('sine') || t.includes('cosine') || t.includes('tan')) thumbKey = 'trig';
    else if (t.includes('geom') || t.includes('angle') || t.includes('triangle') || t.includes('ruler') || t.includes('compass')) thumbKey = 'geometry';
    else if (t.includes('calc') || t.includes('deriv') || t.includes('integr') || t.includes('limit')) thumbKey = 'calculus';
    var thumbSvg = _courseThumbSvgs[thumbKey];
    var thumbHtml = c.img ? '<img src="' + esc(c.img) + '" alt="' + esc(c.title) + '" loading="lazy">' : thumbSvg;
    var updatedLabel = '';
    if (c.updated_at) {
      var d = new Date(c.updated_at);
      var now = new Date();
      var diffMs = now - d;
      var diffDays = Math.floor(diffMs / 86400000);
      if (diffDays === 0) updatedLabel = 'Updated today';
      else if (diffDays === 1) updatedLabel = 'Updated yesterday';
      else if (diffDays < 7) updatedLabel = 'Updated ' + diffDays + ' days ago';
      else if (diffDays < 30) updatedLabel = 'Updated ' + Math.floor(diffDays / 7) + ' weeks ago';
      else updatedLabel = 'Updated ' + d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    }
    var progressHtml = '';
    if (pct > 0) {
      progressHtml = '<div class="lc-progress"><div class="lc-progress-lbl">Progress</div><div class="lc-progress-bar"><div class="lc-progress-fill" style="width:' + pct + '%"></div></div></div>';
    }
    var btnLabel = pct > 0 ? 'Continue' : 'Start Course';
    var btnClass = pct > 0 ? 'lc-btn' : 'lc-btn lc-btn-outline';
    return '<div class="lc-card" onclick="showView(\'courses\')">' +
      '<div class="lc-thumb">' + thumbHtml + '</div>' +
      '<div class="lc-body">' +
      '<div class="lc-badge">' + lvlLabel + '</div>' +
      '<h3>' + esc(c.title) + '</h3>' +
      '<p>' + esc(c.desc) + '</p>' +
      '<div class="lc-meta"><span>&#128196; ' + tot + ' Lesson' + (tot !== 1 ? 's' : '') + '</span><span>&#128260; ' + updatedLabel + '</span></div>' +
      '</div>' +
      '<div class="lc-right">' +
      progressHtml +
      '<button class="' + btnClass + '" onclick="event.stopPropagation();showView(\'courses\')">' + btnLabel + ' &rarr;</button>' +
      '</div></div>';
  }).join('');
}

async function loadUserAndProgress() {
  const { data: profile } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
  userProfile = profile;
  const { data: prog } = await sb.from('progress').select('*').eq('user_id', currentUser.id);
  Progress = {};
  if (prog) prog.forEach(p => {
    Progress[p.lesson_id] = {
      hwScore: p.hw_score, hwResult: p.hw_result,
      completed: p.exam_completed, score: p.exam_score,
      lastResult: p.exam_result,
      lastAttempt: p.updated_at ? new Date(p.updated_at).getTime() : undefined,
      progress: p.exam_completed ? 100 : undefined, inProgress: false
    };
  });
  var [attemptsR, finalR] = await Promise.all([
    sb.from('exam_attempts').select('*').eq('user_id', currentUser.id).order('created_at'),
    sb.from('final_exam_attempts').select('*').eq('user_id', currentUser.id).maybeSingle()
  ]);
  window._examAttempts = {};
  if (attemptsR.data) attemptsR.data.forEach(function(a) {
    if (!window._examAttempts[a.lesson_id]) window._examAttempts[a.lesson_id] = [];
    window._examAttempts[a.lesson_id].push(a);
  });
  window._finalExam = finalR.data || null;
}

function saveProgress() {
  if (!currentUser) return;
  (async () => {
    for (const [lessonId, d] of Object.entries(Progress)) {
      await sb.from('progress').upsert({
        user_id: currentUser.id, lesson_id: parseInt(lessonId),
        hw_score: d.hwScore, exam_score: d.score,
        exam_completed: d.completed || false,
        hw_result: d.hwResult || null, exam_result: d.lastResult || null
      }, { onConflict: 'user_id, lesson_id' });
    }
  })();
}

async function loadAttemptsForLesson(lid) {
  if (!window._examAttempts) window._examAttempts = {};
  if (window._examAttempts[lid]) return window._examAttempts[lid];
  var { data } = await sb.from('exam_attempts').select('*').eq('user_id', currentUser.id).eq('lesson_id', lid).order('attempt_number');
  window._examAttempts[lid] = data || [];
  return window._examAttempts[lid];
}

function updateAuthUI() {
  const el = document.getElementById('auth-status');
  if (!el) return;
  if (currentUser && userProfile) {
    const init = (userProfile.name || 'U').charAt(0).toUpperCase();
    el.textContent = '';
    var wrap = document.createElement('div');
    wrap.className = 'avatar';
    wrap.onclick = function() { showView('profile'); };
    wrap.title = 'Profile';
    if (userProfile.profile_pic) {
      var img = document.createElement('img');
      img.src = userProfile.profile_pic;
      img.alt = '';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
      wrap.appendChild(img);
    } else {
      wrap.textContent = init;
    }
    el.appendChild(wrap);
  } else {
    el.innerHTML = '<button class="btn btn-primary btn-sm" onclick="showAuthModal()">Log In</button>';
  }
  updateNotifUI();
}

function showAuthModal() { document.getElementById('auth-modal').classList.add('show'); }
function hideAuthModal() { document.getElementById('auth-modal').classList.remove('show'); }

function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.textContent.trim().toLowerCase().includes(tab)));
  document.getElementById('auth-login-form').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('auth-signup-form').style.display = tab === 'signup' ? 'block' : 'none';
}

async function login() {
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { alert(error.message); return; }
  currentUser = data.user;
  await loadUserAndProgress();
  var ok = await checkDeviceLimit();
  if (!ok) { hideAuthModal(); return; }
  hideAuthModal();
  updateAuthUI();
  renderProfile();
  renderCourses();
  renderPlatform();
}

async function signUp() {
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const name = document.getElementById('signup-name').value.trim();
  const level = document.getElementById('signup-level')?.value || 'sec1';
  if (!email || !password || !name) { alert('Please fill in all fields.'); return; }
  var { error } = await sb.auth.signUp({ email, password, options: { data: { name, level } } });
  if (error) { alert(error.message); return; }
  document.getElementById('signup-actions').style.display = 'none';
  document.getElementById('signup-verify').style.display = 'block';
}
function resendSignupCode(e) {
  e.preventDefault();
  const email = document.getElementById('signup-email').value.trim();
  if (!email) return;
  sb.auth.resend({ type: 'signup', email });
}

async function signOut() {
  await sb.auth.signOut();
  currentUser = null; userProfile = null; Progress = {};
  updateAuthUI(); renderProfile(); renderCourses();
}

// ── Device limit (max 2 devices per account) ──
function getDeviceId() {
  var did;
  try { did = localStorage.getItem('_device_id'); } catch(e) {}
  if (!did) {
    var parts = [
      navigator.userAgent,
      screen.width + 'x' + screen.height + 'x' + screen.colorDepth,
      navigator.language,
      navigator.hardwareConcurrency || '',
      Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36))
    ];
    var raw = parts.join('|||');
    var h = 0;
    for (var i = 0; i < raw.length; i++) { h = ((h << 5) - h) + raw.charCodeAt(i); h |= 0; }
    did = 'd_' + Math.abs(h).toString(36);
    try { localStorage.setItem('_device_id', did); } catch(e) {}
  }
  return did;
}
function getDeviceName() {
  var ua = navigator.userAgent;
  var name = 'Unknown';
  if (ua.indexOf('Windows') !== -1) name = 'Windows';
  else if (ua.indexOf('Mac OS') !== -1) name = 'macOS';
  else if (ua.indexOf('Linux') !== -1) name = 'Linux';
  else if (ua.indexOf('Android') !== -1) name = 'Android';
  else if (ua.indexOf('iPhone') !== -1 || ua.indexOf('iPad') !== -1) name = 'iOS';
  var browser = 'Unknown';
  if (ua.indexOf('Chrome') !== -1) browser = 'Chrome';
  else if (ua.indexOf('Firefox') !== -1) browser = 'Firefox';
  else if (ua.indexOf('Safari') !== -1) browser = 'Safari';
  else if (ua.indexOf('Edge') !== -1) browser = 'Edge';
  return name + ' · ' + browser;
}
async function checkDeviceLimit() {
  if (!currentUser) return true;
  var did = getDeviceId();
  var { data: existing } = await sb.from('user_devices').select('id').eq('user_id', currentUser.id).eq('device_id', did).maybeSingle();
  if (existing) {
    await sb.from('user_devices').update({ last_login: new Date().toISOString(), device_name: getDeviceName() }).eq('id', existing.id);
    return true;
  }
  var { data: limitRow } = await sb.from('user_device_limits').select('max_devices').eq('user_id', currentUser.id).maybeSingle();
  var maxD = limitRow ? limitRow.max_devices : 2;
  var { count } = await sb.from('user_devices').select('id', { count: 'exact', head: true }).eq('user_id', currentUser.id);
  if (count >= maxD) {
    var html = '<div style="text-align:center;padding:16px"><div style="font-size:2.5rem;margin-bottom:12px">&#128274;</div>';
    html += '<h3 style="margin:0 0 8px">Device Limit Reached</h3>';
    html += '<p style="color:var(--muted);font-size:.875rem;line-height:1.6">You can only log in from <strong>' + maxD + ' device(s)</strong>. This account is already active on ' + count + ' device(s).</p>';
    html += '<p style="color:var(--muted);font-size:.875rem;line-height:1.6">Please contact support to increase your device limit.</p>';
    html += '<button class="btn btn-primary" style="margin-top:12px" onclick="hideModal();showView(\'support\')">Contact Support</button></div>';
    showModal(html);
    await sb.auth.signOut();
    currentUser = null; userProfile = null; Progress = {};
    updateAuthUI(); renderProfile();
    return false;
  }
  await sb.from('user_devices').insert({
    user_id: currentUser.id, device_id: did, device_name: getDeviceName(), last_login: new Date().toISOString()
  });
  return true;
}
async function updateProfileLevel(level) {
  if (!level || !currentUser) return;
  const { error } = await sb.from('profiles').update({ level }).eq('id', currentUser.id);
  if (error) { alert(error.message); return; }
  if (userProfile) userProfile.level = level;
  renderProfile();
  renderCourses();
}

function renderProfile() {
  const container = document.getElementById('pv-content');
  if (!container) return;
  if (!currentUser) {
    container.innerHTML =
      '<div class="pv-photo-wrap"><div class="pv-photo" id="profile-avatar">?</div></div>' +
      '<h2 class="pv-name">Not signed in</h2>' +
      '<p class="pv-email">Sign in to see your progress</p>' +
      '<p style="color:var(--muted);font-size:.875rem;margin-top:16px"><a href="#" onclick="showAuthModal();return false">Sign in</a> to track progress.</p>';
    return;
  }
  const level = userProfile?.level || 'sec1';
  const levelCourses = COURSES.filter(c => c.level === level);
  const levelLessonIds = new Set();
  levelCourses.forEach(c => c.lessons.forEach(l => levelLessonIds.add(l.id)));
  const entries = Object.entries(Progress);

  // Done count — only current level
  const done = entries.filter(([id, v]) => v.completed && levelLessonIds.has(Number(id))).length;
  const totalLessons = levelCourses.reduce((s, c) => s + c.lessons.length, 0);

  // Avg score — only current level
  const levelAvg = entries.filter(([id, v]) => v.score != null && levelLessonIds.has(Number(id)));
  const avgScore = levelAvg.length ? Math.round(levelAvg.reduce((s, [,v]) => s + v.score, 0) / levelAvg.length) : null;

  // Exam stats — from _examAttempts
  var allAttempts = [];
  for (var lid in window._examAttempts) {
    window._examAttempts[lid].forEach(function(a) { allAttempts.push(a); });
  }
  var totalAttempts = allAttempts.length;
  var passed = allAttempts.filter(function(a) { return a.total > 0 && (a.score / a.total) >= 0.6; }).length;
  var passRate = totalAttempts > 0 ? Math.round(passed / totalAttempts * 100) : null;
  var bestPct = 0;
  allAttempts.forEach(function(a) {
    if (a.total > 0) { var p = Math.round(a.score / a.total * 100); if (p > bestPct) bestPct = p; }
  });

  // Avatar
  const init = (userProfile?.name || 'U').charAt(0).toUpperCase();
  var avatarHtml = userProfile?.profile_pic
    ? '<img src="' + esc(userProfile.profile_pic) + '" alt="Profile photo">'
    : init;

  // Level dropdown
  var levelHtml = '<div class="cm-dropdown" id="profile-level-dropdown"><button class="cm-dropdown-trigger" onclick="toggleProfileLevelDropdown()" type="button"><span id="profile-level-label">'+(level==='sec1'?'Secondary 1':level==='sec2'?'Secondary 2':'Secondary 3')+'</span><svg class="cm-dropdown-arrow" width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div class="cm-dropdown-menu" id="profile-level-menu"><div class="cm-dropdown-item'+(level==='sec1'?' active':'')+'" data-value="sec1" onclick="selectProfileLevel(\'sec1\')">Secondary 1</div><div class="cm-dropdown-item'+(level==='sec2'?' active':'')+'" data-value="sec2" onclick="selectProfileLevel(\'sec2\')">Secondary 2</div><div class="cm-dropdown-item'+(level==='sec3'?' active':'')+'" data-value="sec3" onclick="selectProfileLevel(\'sec3\')">Secondary 3</div></div></div>';

  // Lesson progress — grouped by course
  var progressHtml = '';
  levelCourses.forEach(function(c) {
    var courseDone = c.lessons.filter(function(l) { return Progress[l.id]?.completed; }).length;
    progressHtml += '<div class="pv-course-group"><div class="pv-course-group-title">' + esc(c.title) + ' <span class="pv-course-group-count">' + courseDone + '/' + c.lessons.length + '</span></div>';
    c.lessons.forEach(function(l) {
      var p = Progress[l.id];
      var score = p?.score || 0;
      var cls = p?.completed ? '' : ' pending';
      progressHtml += '<div class="pv-progress-row' + cls + '"><span class="pv-progress-row-title">' + esc(l.title) + '</span><span class="pv-progress-row-score">' + (p?.completed ? score + '%' : '—') + '</span><div class="pv-progress-row-bar"><div class="pv-progress-row-fill" style="width:' + (p?.completed ? score : 0) + '%"></div></div></div>';
    });
    progressHtml += '</div>';
  });

  container.innerHTML =
    '<div class="pv-photo-wrap"><div class="pv-photo" id="profile-avatar">' + avatarHtml + '</div>' +
    '<label class="pv-photo-edit" title="Change photo"><input type="file" accept="image/*" hidden onchange="uploadProfilePic(event)"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 3a1 1 0 0 1 1 1v5h5a1 1 0 1 1 0 2h-5v5a1 1 0 1 1-2 0v-5H4a1 1 0 1 1 0-2h5V4a1 1 0 0 1 1-1z" fill="currentColor"/></svg></label></div>' +
    '<h2 class="pv-name">' + esc(userProfile?.name || 'User') + '</h2>' +
    '<p class="pv-email">' + esc(currentUser.email || '') + '</p>' +
    '<div class="pv-level">' + levelHtml + '</div>' +
    // Stats row
    '<div class="pv-stats"><div class="pv-stat"><span class="pv-stat-num">' + done + '/' + totalLessons + '</span><span class="pv-stat-lbl">Lessons Done</span></div>' +
    '<div class="pv-stat-divider"></div>' +
    '<div class="pv-stat"><span class="pv-stat-num">' + (avgScore != null ? avgScore + '%' : '—') + '</span><span class="pv-stat-lbl">Avg Score</span></div></div>' +
    // Account settings
    '<div class="pv-section"><h3 class="pv-section-title">Account Settings</h3>' +
    '<div class="pv-setting"><span class="pv-setting-label">Email</span><span class="pv-setting-value">' + esc(currentUser.email || '') + '</span>' +
    (currentUser.email_confirmed_at ? '<span class="pv-verified-badge">✓ Verified</span>' : '<span class="pv-unverified-badge">Unverified</span>') + '</div>' +
    '<div class="pv-setting"><span class="pv-setting-label">Display Name</span><span class="pv-setting-value" id="pv-name-display">' + esc(userProfile?.name || 'User') + '</span><button class="btn btn-ghost btn-xs" onclick="editProfileName()">Edit</button></div>' +
    '<div class="pv-setting"><span class="pv-setting-label">Password</span><span class="pv-setting-value">••••••••</span><button class="btn btn-ghost btn-xs" onclick="showPasswordForm()">Change</button></div>' +
    '<div id="pv-pw-form" style="display:none;margin-top:10px"><input type="password" id="pv-new-pw" class="pv-input" placeholder="New password" style="margin-bottom:8px;display:block;width:100%"><input type="password" id="pv-confirm-pw" class="pv-input" placeholder="Confirm password" style="margin-bottom:8px;display:block;width:100%"><button class="btn btn-primary btn-sm" onclick="changePassword()">Save</button> <button class="btn btn-ghost btn-sm" onclick="closePasswordForm()">Cancel</button></div></div>' +
    // Exam stats
    '<div class="pv-section"><h3 class="pv-section-title">Exam Statistics</h3>' +
    '<div class="pv-stats"><div class="pv-stat"><span class="pv-stat-num">' + totalAttempts + '</span><span class="pv-stat-lbl">Attempts</span></div>' +
    '<div class="pv-stat-divider"></div>' +
    '<div class="pv-stat"><span class="pv-stat-num">' + (passRate != null ? passRate + '%' : '—') + '</span><span class="pv-stat-lbl">Pass Rate</span></div>' +
    '<div class="pv-stat-divider"></div>' +
    '<div class="pv-stat"><span class="pv-stat-num">' + (bestPct > 0 ? bestPct + '%' : '—') + '</span><span class="pv-stat-lbl">Best Score</span></div></div></div>' +
    // Lesson progress
    '<div class="pv-section"><h3 class="pv-section-title">Lesson Progress</h3>' +
    (progressHtml || '<p style="color:var(--muted);font-size:.875rem">Complete a lesson to see progress here.</p>') + '</div>' +
    // Sign out
    '<button class="btn btn-outline pv-signout" onclick="signOut()">Sign Out</button>';
}

function compressImage(file, maxW, quality) {
  return new Promise(function(resolve) {
    if (!file.type.startsWith('image/')) { resolve(file); return; }
    var reader = new FileReader();
    reader.onload = function(e) {
      var img = new Image();
      img.onload = function() {
        var w = img.width, h = img.height;
        if (w <= maxW && quality >= 1 && file.type === 'image/jpeg') { resolve(file); return; }
        if (w > maxW) { h = h * maxW / w; w = maxW; }
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(function(blob) {
          blob.name = file.name;
          resolve(blob);
        }, 'image/jpeg', quality);
      };
      img.onerror = function() { resolve(file); };
      img.src = e.target.result;
    };
    reader.onerror = function() { resolve(file); };
    reader.readAsDataURL(file);
  });
}
function uploadProfilePic(event) {
  const file = event.target.files[0];
  if (!file || !currentUser) return;
  compressImage(file, 400, 0.8).then(function(compressed) {
    const path = 'profiles/' + currentUser.id + '/' + Date.now() + '.jpg';
    const formData = new FormData();
    formData.append('file', compressed);
    sb.auth.getSession().then(function(ses) {
      var token = ses.data.session ? ses.data.session.access_token : SUPABASE_ANON_KEY;
      const xhr = new XMLHttpRequest();
      xhr.open('POST', SUPABASE_URL + '/storage/v1/object/question-images/' + path);
      xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      xhr.upload.onprogress = function(e) {
        if (e.lengthComputable) {
          var pct = Math.round(e.loaded / e.total * 100);
          var pel = document.getElementById('profile-avatar');
          if (pel) pel.textContent = pct + '%';
        }
      };
      xhr.onload = function() {
        if (xhr.status === 200) {
          const url = SUPABASE_URL + '/storage/v1/object/public/question-images/' + path;
          sb.from('profiles').update({ profile_pic: url }).eq('id', currentUser.id).then(function(res) {
            if (res.error) { alert('Failed to save photo: ' + res.error.message); return; }
            if (userProfile) userProfile.profile_pic = url;
            renderProfile();
            updateAuthUI();
          });
        } else {
          alert('Upload failed: ' + xhr.statusText);
          renderProfile();
        }
      };
      xhr.onerror = function() { alert('Upload failed'); renderProfile(); };
      xhr.send(formData);
    });
  });
}

function editProfileName() {
  var newName = prompt('Enter your display name:', userProfile?.name || '');
  if (!newName || newName.trim() === '' || newName === userProfile?.name) return;
  (async function() {
    var { error } = await sb.from('profiles').update({ name: newName.trim() }).eq('id', currentUser.id);
    if (error) { alert(error.message); return; }
    if (userProfile) userProfile.name = newName.trim();
    renderProfile();
    updateAuthUI();
  })();
}
function showPasswordForm() {
  var f = document.getElementById('pv-pw-form');
  if (f) f.style.display = 'block';
}
function closePasswordForm() {
  var f = document.getElementById('pv-pw-form');
  if (f) { f.style.display = 'none'; document.getElementById('pv-new-pw').value = ''; document.getElementById('pv-confirm-pw').value = ''; }
}
function changePassword() {
  var pw = document.getElementById('pv-new-pw').value;
  var confirm = document.getElementById('pv-confirm-pw').value;
  if (!pw || pw.length < 6) { alert('Password must be at least 6 characters.'); return; }
  if (pw !== confirm) { alert('Passwords do not match.'); return; }
  (async function() {
    var { error } = await sb.auth.updateUser({ password: pw });
    if (error) { alert(error.message); return; }
    alert('Password updated successfully.');
    closePasswordForm();
  })();
}

// ============ SMART REVIEW ============
function lessonTitle(lid) {
  for (var ci = 0; ci < COURSES.length; ci++)
    for (var li = 0; li < COURSES[ci].lessons.length; li++)
      if (COURSES[ci].lessons[li].id === lid) return COURSES[ci].lessons[li].title;
  return 'Lesson ' + lid;
}

async function renderReviewPage() {
  var el = document.getElementById('review-content');
  if (!el || !currentUser) { if(el) el.innerHTML = '<div class="empty-state"><h3>Please log in</h3></div>'; return; }
  el.innerHTML = '<div style="text-align:center;padding:48px;color:var(--muted)">Analyzing your mistakes…</div>';
  try {
    var { data: attempts } = await sb.from('exam_attempts').select('*').eq('user_id', currentUser.id).order('created_at');
    if (!attempts) attempts = [];
    // Collect unique question IDs across all attempts
    var idMap = {}, uniqueItems = [];
    attempts.forEach(function(a) {
      if (!a.question_order) return;
      a.question_order.forEach(function(item) {
        var key = item.question_type + '_' + item.question_id;
        if (!idMap[key]) { idMap[key] = item; uniqueItems.push(item); }
      });
    });
    var loadedQs = await loadBatchQuestions(uniqueItems);
    var qByKey = {};
    uniqueItems.forEach(function(item, idx) { qByKey[item.question_type + '_' + item.question_id] = loadedQs[idx] || null; });
    // Process all attempts: group mistakes by lesson
    var lessonData = {}, allMistakes = [];
    attempts.forEach(function(a) {
      if (!a.question_order || !a.answers) return;
      var ans = a.answers.answers || [];
      var isReview = a.lesson_id === null;
      a.question_order.forEach(function(item, qi) {
        var lid = isReview ? item.source_lesson_id : a.lesson_id;
        if (!lid) return;
        if (!lessonData[lid]) lessonData[lid] = { lid: lid, total: 0, wrong: 0 };
        lessonData[lid].total++;
        var q = qByKey[item.question_type + '_' + item.question_id];
        if (!q) return;
        var ua = ans[qi];
        if (ua === undefined || ua < 0) return;
        if (Number(ua) !== Number(q.correct)) {
          lessonData[lid].wrong++;
          allMistakes.push({ lid: lid, q: q, ua: ua, ca: q.correct });
        }
      });
    });
    var lessonList = Object.values(lessonData).sort(function(a, b) {
      return (b.wrong / Math.max(1, b.total)) - (a.wrong / Math.max(1, a.total));
    });
    var userLevel = userProfile?.level || null;
    var myCourses = userLevel ? COURSES.filter(function(c) { return c.level === userLevel; }) : COURSES;
    var myLids = {};
    myCourses.forEach(function(c) { c.lessons.forEach(function(l) { myLids[l.id] = true; }); });
    var completedLids = Object.keys(Progress).filter(function(k) { return Progress[k]?.completed && myLids[parseInt(k)]; }).map(Number);
    // Filter lessonList to only include user's level lessons
    lessonList = lessonList.filter(function(l) { return myLids[l.lid]; });
    // Build HTML
    var html = '';
    // Smart Review CTA
    html += '<div class="rv-section"><div class="rv-hero"><h2>Smart Review</h2><p>Review your mistakes and strengthen weak topics with a targeted mixed exam.</p>';
    if (completedLids.length > 0) {
      var pp = completedLids.length <= 3 ? 5 : completedLids.length <= 6 ? 4 : completedLids.length <= 10 ? 3 : 2;
      html += '<button class="btn btn-primary" onclick="startSmartReview()" style="justify-content:center;margin-top:16px">Start Smart Review &mdash; ' + completedLids.length + ' lessons &middot; up to ' + (completedLids.length * pp) + ' questions</button>';
    } else {
      html += '<p style="color:var(--muted);font-size:.875rem;margin-top:8px">Complete at least one lesson to start a Smart Review.</p>';
    }
    html += '</div></div>';
    // Latest Smart Review from DB or localStorage
    var lsRaw = null; try { lsRaw = localStorage.getItem('latestReview'); } catch(e) {}
    var latestReview = lsRaw ? JSON.parse(lsRaw) : null;
    var dbReview = attempts.filter(function(a) { return a.lesson_id === null; }).sort(function(a, b) { return (b.attempt_number || 0) - (a.attempt_number || 0); })[0];
    var rvStats = null, rvScore = 0, rvTotal = 0;
    if (dbReview && dbReview.answers) {
      rvStats = dbReview.answers.lessonStats || null;
      rvScore = dbReview.answers.score || dbReview.score || 0;
      rvTotal = dbReview.answers.total || dbReview.total || 0;
    } else if (latestReview) {
      rvStats = latestReview.lessonStats || null;
      rvScore = latestReview.score || 0;
      rvTotal = latestReview.total || 0;
    }
    if (rvTotal > 0) {
      var pct = Math.round(rvScore / rvTotal * 100);
      html += '<div class="rv-section"><div class="rv-section-header"><div class="rv-section-title">Latest Smart Review</div><div class="rv-section-desc">Your most recent mixed exam results</div></div><div class="rv-hero-r">';
      html += '<div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;justify-content:center"><span style="font-size:1.75rem;font-weight:800;color:var(--primary);font-variant-numeric:tabular-nums">' + pct + '%</span><span style="font-size:.8125rem;color:var(--muted)">' + rvScore + '/' + rvTotal + ' correct</span></div>';
      if (rvStats && rvStats.length > 0) {
        html += '<div style="margin-top:16px">';
        rvStats.sort(function(a, b) { return ((b.wrg||0)/(b.cnt||1)) - ((a.wrg||0)/(a.cnt||1)); }).forEach(function(s) {
          html += '<div class="rv-rank-row" style="justify-content:space-between"><span class="rv-rank-title" style="flex:none">' + esc(lessonTitle(s.lid)) + '</span><span class="rv-rank-count">' + (s.wrg||0) + '/' + (s.cnt||1) + ' wrong</span></div>';
        });
        html += '</div>';
      }
      html += '</div></div>';
    }
    // Weakest Lessons
    if (lessonList.length > 0) {
      html += '<div class="rv-section"><div class="rv-section-header"><div class="rv-section-title">Weakest Lessons</div><div class="rv-section-desc">Lessons ranked by error rate</div></div>';
      lessonList.forEach(function(l, i) {
        html += '<div class="rv-rank-row" style="justify-content:space-between"><span class="rv-rank-num">#' + (i+1) + '</span><span class="rv-rank-title">' + esc(lessonTitle(l.lid)) + '</span><span class="rv-rank-count">' + l.wrong + ' mistake' + (l.wrong !== 1 ? 's' : '') + '</span></div>';
      });
      html += '</div>';
    }
    // Mistakes grouped by lesson
    if (allMistakes.length > 0) {
      var byL = {};
      allMistakes.forEach(function(m) { if (!byL[m.lid]) byL[m.lid] = []; byL[m.lid].push(m); });
      html += '<div class="rv-section"><div class="rv-section-header"><div class="rv-section-title">Your Mistakes</div><div class="rv-section-desc">Review each mistake and the correct answer</div></div>';
      lessonList.forEach(function(l) {
        var ms = byL[l.lid] || [];
        if (ms.length === 0) return;
        html += '<details class="rv-mistake-group" open><summary class="rv-mistake-summary">' + esc(lessonTitle(l.lid)) + ' <span class="rv-mistake-count">' + ms.length + ' mistakes</span></summary><div class="rv-mistake-list">';
        ms.forEach(function(m) {
          html += '<div class="rv-mistake-card"><div class="rv-mistake-q">';
          if (m.q.isImage) {
            var SU = 'https://usllnkoqqpfynsiprvqh.supabase.co/storage/v1/object/public/question-images/';
            html += '<img src="' + SU + m.q.imgQ + '" style="max-width:100%;border-radius:var(--radius);max-height:160px;border:1px solid var(--border)">';
          } else {
            html += esc(m.q.q || m.q.question || '');
            if (m.q.math) html += ' <span class="math-block" style="display:inline">$$' + esc(m.q.math) + '$$</span>';
          }
          html += '</div><div class="rv-mistake-answers"><svg class="rv-wrong-svg" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="#b33a2c" stroke-width="1.3"/><path d="M4.5 4.5l5 5M9.5 4.5l-5 5" stroke="#b33a2c" stroke-width="1.3" stroke-linecap="round"/></svg><span>Your answer: ' + esc(String(m.q.opts[m.ua] || '—')) + '</span><svg class="rv-right-svg" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="#328f4f" stroke-width="1.3"/><path d="M4 7l2 2 4-4" stroke="#328f4f" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Correct: ' + esc(String(m.q.opts[m.ca] || '—')) + '</span></div></div>';
        });
        html += '</div></details>';
      });
      html += '</div>';
    } else {
      html += '<div class="rv-section"><div class="rv-empty"><div class="rv-empty-icon">&#10003;</div><h3>No mistakes found</h3><p>Keep up the great work! Every question you answer correctly builds confidence.</p></div></div>';
    }
    el.innerHTML = html;
    if (typeof renderMathInElement === 'function') renderMathInElement(el, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '\\(', right: '\\)', display: false }] });
  } catch (e) { el.innerHTML = '<div class="empty-state"><div class="empty-icon">&#9888;&#65039;</div><h3>Error</h3><p>' + esc(e.message) + '</p></div>'; }
}

async function startSmartReview() {
  if (!currentUser) { alert('Please log in.'); return; }
  var userLevel = userProfile?.level || null;
  var myCourses = userLevel ? COURSES.filter(function(c) { return c.level === userLevel; }) : COURSES;
  var myLids = {};
  myCourses.forEach(function(c) { c.lessons.forEach(function(l) { myLids[l.id] = true; }); });
  var completedLids = Object.keys(Progress).filter(function(lid) { return Progress[lid]?.completed && myLids[parseInt(lid)]; }).map(Number);
  if (completedLids.length === 0) { alert('Complete at least one lesson in your level first.'); return; }
  // Scale questions per lesson: fewer as more lessons completed
  var perLesson = completedLids.length <= 3 ? 5 : completedLids.length <= 6 ? 4 : completedLids.length <= 10 ? 3 : 2;
  var { data: attempts } = await sb.from('exam_attempts').select('*').eq('user_id', currentUser.id);
  if (!attempts) attempts = [];
  var allQs = [];
  var qOrder = [];
  for (var ci = 0; ci < myCourses.length; ci++) {
    var course = myCourses[ci];
    for (var li = 0; li < course.lessons.length; li++) {
      var lesson = course.lessons[li];
      if (!Progress[lesson.id]?.completed) continue;
      var exam = lesson.امتحان;
      var hw = lesson.واجب;
      // Collect all lesson questions with IDs (exam + homework)
      var pool = [];
      (exam?.questions || []).forEach(function(q) { pool.push({ id: q.id, type: 'standard', q: q.q, opts: q.opts, correct: q.correct, math: q.math, image_url: q.image_url, option_images: q.option_images }); });
      (exam?.imageQuestions || []).forEach(function(q) { pool.push({ id: q.id, type: 'image', imgQ: q.imgQ, correct: q.correct, explanation: q.explanation, explanation_image_url: q.explanation_image_url }); });
      (hw?.questions || []).forEach(function(q) { pool.push({ id: q.id, type: 'hw_standard', q: q.q, opts: q.opts, correct: q.correct, math: q.math, image_url: q.image_url, option_images: q.option_images }); });
      (hw?.imageQuestions || []).forEach(function(q) { pool.push({ id: q.id, type: 'hw_image', imgQ: q.imgQ, correct: q.correct, explanation: q.explanation, explanation_image_url: q.explanation_image_url }); });
      if (pool.length === 0) continue;
      // Find wrong question IDs from attempts (including previous review attempts)
      var lessonAttempts = attempts.filter(function(a) { return a.lesson_id === lesson.id && a.question_order && a.answers && a.answers.answers; });
      // Also check review attempts (lesson_id = 0) that have this lesson's questions
      attempts.filter(function(a) { return a.lesson_id === null && a.question_order && a.answers && a.answers.answers; }).forEach(function(a) {
        a.question_order.forEach(function(item, qi) {
          if (item.source_lesson_id === lesson.id && item.question_type && item.question_id) {
            lessonAttempts.push({ question_order: [item], answers: { answers: [a.answers.answers[qi]] } });
          }
        });
      });
      var wrongKeySet = {};
      lessonAttempts.forEach(function(a) {
        var qo = a.question_order;
        var ans = a.answers.answers;
        qo.forEach(function(item, qi) {
          if (ans[qi] === undefined || ans[qi] < 0) return;
          var key = item.question_type + '_' + item.question_id;
          if (!wrongKeySet[key]) wrongKeySet[key] = { type: item.question_type, id: item.question_id, userAns: ans[qi] };
        });
      });
      // Load those questions to compare answers
      var wrongArr = Object.values(wrongKeySet);
      var wrongLoaded = [];
      if (wrongArr.length > 0) {
        var batchItems = wrongArr.map(function(w) { return { question_type: w.type, question_id: w.id }; });
        var batchQs = await loadBatchQuestions(batchItems);
        wrongArr.forEach(function(w, idx) {
          var q = batchQs[idx];
          if (q && w.userAns !== undefined && w.userAns !== q.correct) {
            wrongLoaded.push(w.type + '_' + w.id);
          }
        });
      }
      // Shuffle pool
      for (var si = pool.length - 1; si > 0; si--) { var sj = Math.floor(Math.random() * (si + 1)); var st = pool[si]; pool[si] = pool[sj]; pool[sj] = st; }
      var picked = [];
      // Pick up to ~60% from wrong (scaled)
      var wrongInPool = pool.filter(function(p) { return wrongLoaded.indexOf(p.type + '_' + p.id) >= 0; });
      var otherInPool = pool.filter(function(p) { return wrongLoaded.indexOf(p.type + '_' + p.id) < 0; });
      var takeWrong = Math.min(Math.round(perLesson * 0.6), wrongInPool.length);
      for (var wi = 0; wi < takeWrong; wi++) picked.push(wrongInPool[wi]);
      var remaining = perLesson - picked.length;
      for (var ri = 0; ri < remaining && ri < otherInPool.length; ri++) picked.push(otherInPool[ri]);
      // Format for quiz
      picked.forEach(function(p) {
        var qid = p.id;
        var qtype = p.type;
        if (p.type === 'standard' || p.type === 'hw_standard') {
          allQs.push({ qid: qid, qtype: qtype, q: p.q, opts: p.opts, correct: p.correct, math: p.math || '', image_url: p.image_url || '', option_images: p.option_images || [], isImage: false, sourceLid: lesson.id });
        } else {
          var li = p.correct === 'A' ? 0 : p.correct === 'B' ? 1 : p.correct === 'C' ? 2 : p.correct === 'D' ? 3 : 0;
          allQs.push({ qid: qid, qtype: qtype, q: '', opts: ['A', 'B', 'C', 'D'], correct: li, math: '', image_url: '', option_images: [], isImage: true, imgQ: p.imgQ, explanation: p.explanation || '', explanation_image_url: p.explanation_image_url || '', sourceLid: lesson.id });
        }
        qOrder.push({ question_type: qtype, question_id: qid, source_lesson_id: lesson.id });
      });
    }
  }
  if (allQs.length === 0) { alert('No questions available for review.'); return; }
  // Weekly rotation: exclude questions already seen this week
  var weekKey = 'review_week_' + Math.floor(Date.now() / 604800000);
  var seenRaw = localStorage.getItem(weekKey);
  var seenSet = seenRaw ? JSON.parse(seenRaw) : {};
  // Keep unseen questions, plus at most 2 per lesson from seen if needed
  var perLessonCount = {};
  var filteredQs = [];
  var filteredQo = [];
  allQs.forEach(function(q, i) {
    var qkey = q.qtype + '_' + q.qid;
    var sl = q.sourceLid;
    if (!perLessonCount[sl]) perLessonCount[sl] = 0;
    if (!seenSet[qkey]) {
      filteredQs.push(q);
      filteredQo.push(qOrder[i]);
      perLessonCount[sl]++;
    } else if (perLessonCount[sl] < 3) {
      filteredQs.push(q);
      filteredQo.push(qOrder[i]);
      perLessonCount[sl]++;
    }
  });
  // If filtering left too few, relax (include all seen)
  if (filteredQs.length < 5) { filteredQs = allQs; filteredQo = qOrder; }
  allQs = filteredQs; qOrder = filteredQo;
  // Store for saving seen IDs after submission
  window._reviewWeekKey = weekKey;
  window._reviewSeenIds = seenSet;
  window._reviewAllQs = allQs;
  // Shuffle both arrays in parallel so they stay in sync
  for (var si = allQs.length - 1; si > 0; si--) { var sj = Math.floor(Math.random() * (si + 1)); var st = allQs[si]; allQs[si] = allQs[sj]; allQs[sj] = st; st = qOrder[si]; qOrder[si] = qOrder[sj]; qOrder[sj] = st; }
  quizState = { lessonId: null, type: 'review', questions: allQs, total: allQs.length, answers: new Array(allQs.length).fill(-1), submitted: false, questionOrder: qOrder };
  var label = document.getElementById('quiz-type-label');
  if (label) label.textContent = 'Smart Review';
  var bar = document.getElementById('quiz-bar');
  var txt = document.getElementById('quiz-progress-text');
  if (bar) bar.style.width = '0%';
  if (txt) txt.textContent = '0/' + allQs.length;
  showView('quiz');
  renderAllQuestions();
}

function renderPlatform() {
  if (!currentUser || !userProfile) return;
  var name = userProfile.name || 'Student';
  var entries = Object.entries(Progress);
  var done = entries.filter(function(e) { return e[1].completed; }).length;
  var scores = entries.filter(function(e) { return e[1].score != null; });
  var avgScore = scores.length ? Math.round(scores.reduce(function(s, e) { return s + e[1].score; }, 0) / scores.length) : null;
  var examsTotal = 0;
  for (var lid in window._examAttempts) examsTotal += window._examAttempts[lid].length;
  // Find next uncompleted lesson
  var nextLesson = null;
  for (var ci = 0; ci < COURSES.length && !nextLesson; ci++) {
    for (var li = 0; li < COURSES[ci].lessons.length && !nextLesson; li++) {
      if (!Progress[COURSES[ci].lessons[li].id]?.completed) nextLesson = COURSES[ci].lessons[li];
    }
  }
  // Header
  var h = '<div class="dash-header-inner"><div><h1>Welcome back, ' + name + '</h1><p>Continue where you left off.</p></div><button class="btn btn-ghost btn-sm" onclick="showView(\'courses\')">Browse Courses &rarr;</button></div><div class="dash-stats">';
  h += '<div class="ds-card"><div class="ds-val" style="color:var(--primary)">' + done + '</div><div class="ds-lbl">Lessons Done</div></div>';
  h += '<div class="ds-card"><div class="ds-val" style="color:var(--success)">' + (avgScore != null ? avgScore + '%' : '—') + '</div><div class="ds-lbl">Avg Score</div></div>';
  h += '<div class="ds-card"><div class="ds-val">' + examsTotal + '</div><div class="ds-lbl">Exam Attempts</div></div>';
  h += '<div class="ds-card"><div class="ds-val">' + scores.length + '</div><div class="ds-lbl">Quizzes Taken</div></div>';
  h += '</div>';
  document.getElementById('dash-header-content').innerHTML = h;
  // Body content
  var body = '';
  // Continue Learning
  if (nextLesson) {
    body += '<div class="dash-section"><div class="dash-section-title">Continue Learning</div><div class="dash-next-card" onclick="showView(\'courses\')"><div class="dnc-icon">📖</div><div class="dnc-body"><div class="dnc-title">' + nextLesson.title + '</div><div class="dnc-meta">' + (nextLesson.topic || '') + '</div></div><span class="dnc-arrow">&rarr;</span></div></div>';
  }
  // Performance chart (last 30 days)
  body += '<div class="dash-section"><div class="dash-section-title">Performance — Last 30 Days</div><div class="pf-chart-wrap"><canvas id="pf-canvas" height="280"></canvas></div><div class="pf-stats" id="pf-stats"></div></div>';
  // Recent exam attempts
  var allAttempts = [];
  for (var lid in window._examAttempts) {
    window._examAttempts[lid].forEach(function(a) { allAttempts.push(a); });
  }
  allAttempts.sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); });
  var recent = allAttempts.slice(0, 5);
  if (recent.length > 0) {
    body += '<div class="dash-section"><div class="dash-section-title">Recent Exam Results</div><div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Lesson</th><th>Attempt</th><th>Score</th><th>Date</th></tr></thead><tbody>';
    recent.forEach(function(a) {
      var pct = a.total > 0 ? Math.round(a.score / a.total * 100) : 0;
      body += '<tr><td>Lesson ' + a.lesson_id + '</td><td>' + a.attempt_number + '</td><td class="dash-td-score ' + (pct >= 60 ? 'dash-pass' : 'dash-fail') + '">' + pct + '%</td><td class="dash-td-date">' + (a.created_at ? new Date(a.created_at).toLocaleDateString() : '—') + '</td></tr>';
    });
    body += '</tbody></table></div></div>';
  }
  // Progress per course
  body += '<div class="dash-section"><div class="dash-section-title">Course Progress</div><div class="dash-courses">';
  COURSES.forEach(function(c) {
    var total = c.lessons.length;
    var comp = c.lessons.filter(function(l) { return Progress[l.id]?.completed; }).length;
    var pct = total > 0 ? Math.round(comp / total * 100) : 0;
    body += '<div class="dc-course" onclick="showView(\'courses\')"><div class="dcc-icon">' + (c.icon || '📘') + '</div><div class="dcc-body"><div class="dcc-title">' + c.title + '</div><div class="dcc-bar"><div class="dcc-fill" style="width:' + pct + '%' + (pct === 100 ? ';background:var(--success)' : '') + '"></div></div></div><div class="dcc-pct">' + pct + '%</div></div>';
  });
  body += '</div></div>';
  document.getElementById('dash-content').innerHTML = body || '<div style="text-align:center;padding:48px;color:var(--muted)">Start a course to see your progress here.</div>';
  // Draw performance chart
  setTimeout(function() {
    var canvas = document.getElementById('pf-canvas');
    if (canvas) drawPerfChart(canvas);
  }, 50);
}

function drawPerfChart(canvas) {
  // Build weeks from real exam attempt data
  var now = new Date();
  var weeks = [];
  for (var w = 0; w < 4; w++) {
    var weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - (w + 1) * 7);
    var weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() - w * 7);
    var scores = [];
    for (var lid in window._examAttempts) {
      window._examAttempts[lid].forEach(function(a) {
        var d = new Date(a.created_at);
        if (d >= weekStart && d < weekEnd && a.total > 0) {
          scores.push(Math.round(a.score / a.total * 100));
        }
      });
    }
    var avg = scores.length ? Math.round(scores.reduce(function(s, v) { return s + v; }, 0) / scores.length) : null;
    weeks.unshift({ label: 'Week ' + (w + 1), scores: scores, avg: avg });
  }
  // Filter out weeks with no data from display
  var hasData = weeks.some(function(w) { return w.avg != null; });
  var dpr = window.devicePixelRatio || 1;
  var W = canvas.offsetWidth;
  var H = 280;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  var ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  var pad = { top: 30, bottom: 44, left: 52, right: 24 };
  var cw = W - pad.left - pad.right;
  var ch = H - pad.top - pad.bottom;
  var bg = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#f8f8f8';
  var brd = getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || '#ddd';
  var mut = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#888';
  var prim = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#d4943b';
  var ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#222';
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  if (!hasData) {
    ctx.fillStyle = mut;
    ctx.font = '14px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No exam data yet — complete a lesson exam to see your performance.', W / 2, H / 2);
    var se = document.getElementById('pf-stats');
    if (se) se.innerHTML = '';
    return;
  }
  // Grid
  ctx.strokeStyle = brd;
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);
  for (var g = 0; g <= 4; g++) {
    var y = pad.top + ch - (g / 4) * ch;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = mut;
    ctx.font = '13px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText((g * 25) + '%', pad.left - 10, y);
    ctx.setLineDash([5, 5]);
  }
  ctx.setLineDash([]);
  // Plot points — only weeks with data
  var pts = [];
  var validWeeks = weeks.filter(function(w) { return w.avg != null; });
  validWeeks.forEach(function(week, wi) {
    var x = pad.left + (wi / Math.max(validWeeks.length - 1, 1)) * cw;
    pts.push({ x: x, y: pad.top + ch - (week.avg / 100) * ch, week: week });
  });
  if (pts.length > 0) {
    // Line
    ctx.strokeStyle = prim;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    pts.forEach(function(p, i) { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
    ctx.stroke();
    // Dots + labels
    pts.forEach(function(p) {
      ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = prim; ctx.lineWidth = 3; ctx.stroke();
      ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fillStyle = prim; ctx.fill();
      ctx.fillStyle = ink;
      ctx.font = 'bold 16px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(p.week.avg + '%', p.x, p.y - 16);
      ctx.fillStyle = mut;
      ctx.font = '13px Inter, sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText(p.week.label, p.x, pad.top + ch + 8);
      ctx.fillText(p.week.scores.length + ' sessions', p.x, pad.top + ch + 26);
    });
  }
  // Stats
  var allAvgs = validWeeks.map(function(w) { return w.avg; });
  var oAvg = allAvgs.length ? Math.round(allAvgs.reduce(function(s, v) { return s + v; }, 0) / allAvgs.length) : null;
  var first = validWeeks.length > 0 ? validWeeks[0].avg : null;
  var last = validWeeks.length > 0 ? validWeeks[validWeeks.length - 1].avg : null;
  var chg = (first != null && last != null) ? last - first : null;
  var totalSessions = weeks.reduce(function(s, w) { return s + w.scores.length; }, 0);
  var se = document.getElementById('pf-stats');
  if (se) {
    se.innerHTML = !oAvg
      ? '<div class="pf-stat" style="grid-column:1/-1"><span class="pf-stat-lbl">Complete an exam to see stats.</span></div>'
      : '<div class="pf-stat"><span class="pf-stat-val">' + oAvg + '%</span><span class="pf-stat-lbl">30-Day Average</span></div>' +
        '<div class="pf-stat"><span class="pf-stat-val" style="color:' + (chg >= 0 ? 'var(--success)' : 'var(--error)') + '">' + (chg >= 0 ? '▲ +' : '▼ ') + Math.abs(chg) + '%</span><span class="pf-stat-lbl">First → Last Week</span></div>' +
        '<div class="pf-stat"><span class="pf-stat-val">' + totalSessions + '</span><span class="pf-stat-lbl">Sessions Logged</span></div>';
  }
}

function closeMobileNav() {
  var nv = document.getElementById('nv1'); var ov = document.getElementById('nv-overlay');
  if (nv) nv.classList.remove('open'); if (ov) ov.classList.remove('show');
}
function updateNavIndicator() {
  var active = document.querySelector('.nv1 .nv-link.active');
  var indicator = document.getElementById('nv-indicator');
  if (!active || !indicator || window.innerWidth <= 900) { if (indicator) indicator.style.opacity = '0'; return; }
  requestAnimationFrame(function() {
    indicator.style.opacity = '1';
    indicator.style.width = active.offsetWidth + 'px';
    indicator.style.transform = 'translateX(' + active.offsetLeft + 'px)';
  });
}
// Reposition indicator on resize
var _navResizeTimer = null;
window.addEventListener('resize', function() {
  clearTimeout(_navResizeTimer);
  _navResizeTimer = setTimeout(updateNavIndicator, 100);
});
function showView(view, data) {
  closeMobileNav();
  document.querySelectorAll('.landing-view, .platform-view, .courses-view, .quiz-view, .content-view, .profile-view, .review-view, .community-view, .support-view, .video-player-view').forEach(v => v.style.display = 'none');
  if (view === 'landing') { document.getElementById('view-landing').style.display = 'block'; document.querySelectorAll('.nv1 .nv-link').forEach(l => l.classList.remove('active')); updateNavIndicator(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  else if (view === 'platform') { document.getElementById('view-platform').style.display = 'block'; renderPlatform(); }
  else if (view === 'courses') { document.getElementById('view-courses').style.display = 'block'; renderCourses(); }
  else if (view === 'quiz') { document.getElementById('view-quiz').style.display = 'block'; }
  else if (view === 'content') { document.getElementById('view-content').style.display = 'block'; renderContentPage(data).catch(()=>{}); }
  else if (view === 'profile') { document.getElementById('view-profile').style.display = 'block'; renderProfile(); }
  else if (view === 'review') { document.getElementById('view-review').style.display = 'block'; renderReviewPage(); }
  else if (view === 'community') { document.getElementById('view-community').style.display = 'block'; showCommunity(); }
  else if (view === 'support') { document.getElementById('view-support').style.display = 'block'; showSupportPage(); }
  else if (view === 'video-player') { document.getElementById('view-video-player').style.display = 'block'; }
  document.querySelectorAll('.nv1 .nv-link').forEach(l => l.classList.remove('active'));
  var activeLink = document.querySelector('.nv1 .nv-link[data-view="' + view + '"]');
  if (activeLink) activeLink.classList.add('active');
  updateNavIndicator();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function getLesson(id) {
  for (const c of COURSES) for (const l of c.lessons) if (l.id === id) return { lesson: l, course: c };
  return null;
}

var _courseThumbSvgs = {
  algebra: '<svg viewBox="0 0 280 150" fill="none"><rect width="280" height="150" rx="16" fill="#FAF7F0"/><path d="M40 110 L50 90 L60 100 L70 70 L80 85 L90 60 L100 75 L110 50 L120 65" stroke="#D4A017" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M130 55 C135 40 145 35 155 50 C165 65 175 30 185 45" stroke="#13294B" stroke-width="2" stroke-linecap="round" fill="none" opacity=".5"/><rect x="46" y="25" width="28" height="28" rx="4" stroke="#13294B" stroke-width="1.5" fill="#13294B" fill-opacity=".06"/><text x="52" y="44" font-family="serif" font-size="12" fill="#D4A017" font-weight="700">x²</text><polygon points="200,40 220,40 220,60 200,60" stroke="#13294B" stroke-width="1.5" fill="#13294B" fill-opacity=".04"/><line x1="205" y1="50" x2="215" y2="50" stroke="#13294B" stroke-width="1.5"/><line x1="210" y1="45" x2="210" y2="55" stroke="#13294B" stroke-width="1.5"/><path d="M185 95 Q190 80 200 90 Q210 100 215 85" stroke="#D4A017" stroke-width="1.5" fill="none" opacity=".4"/><circle cx="160" cy="100" r="8" stroke="#D4A017" stroke-width="1" fill="none"/><circle cx="160" cy="100" r="3" fill="#13294B" opacity=".3"/></svg>',
  trig: '<svg viewBox="0 0 280 150" fill="none"><rect width="280" height="150" rx="16" fill="#FAF7F0"/><circle cx="80" cy="75" r="35" stroke="#13294B" stroke-width="1.5" fill="none"/><line x1="80" y1="75" x2="105" y2="57" stroke="#D4A017" stroke-width="2"/><line x1="80" y1="75" x2="115" y2="75" stroke="#13294B" stroke-width="1" opacity=".3"/><path d="M82 70 L87 73 L84 78" stroke="#D4A017" stroke-width="1" fill="none"/><path d="M45 108 C55 108 60 70 80 75 C100 80 105 60 115 57" stroke="#D4A017" stroke-width="1.5" fill="none" opacity=".5"/><line x1="170" y1="110" x2="170" y2="40" stroke="#13294B" stroke-width="1" opacity=".15"/><line x1="150" y1="75" x2="230" y2="75" stroke="#13294B" stroke-width="1" opacity=".15"/><path d="M160 75 Q170 90 180 75 Q190 60 200 75 Q210 90 220 75" stroke="#D4A017" stroke-width="2" fill="none"/><circle cx="170" cy="75" r="3" fill="#13294B"/><circle cx="180" cy="75" r="3" fill="#13294B"/><circle cx="190" cy="75" r="3" fill="#13294B"/><circle cx="200" cy="75" r="3" fill="#13294B"/><circle cx="210" cy="75" r="3" fill="#13294B"/><line x1="80" y1="36" x2="80" y2="114" stroke="#13294B" stroke-width="1" opacity=".1"/></svg>',
  geometry: '<svg viewBox="0 0 280 150" fill="none"><rect width="280" height="150" rx="16" fill="#FAF7F0"/><polygon points="60,110 130,30 200,110" stroke="#13294B" stroke-width="2" fill="#13294B" fill-opacity=".04"/><line x1="130" y1="30" x2="130" y2="110" stroke="#D4A017" stroke-width="1.5" stroke-dasharray="4 3"/><line x1="60" y1="110" x2="200" y2="110" stroke="#13294B" stroke-width="1" opacity=".2"/><circle cx="130" cy="30" r="4" fill="#D4A017"/><circle cx="60" cy="110" r="4" fill="#D4A017"/><circle cx="200" cy="110" r="4" fill="#D4A017"/><rect x="165" y="38" width="50" height="50" rx="4" transform="rotate(15 165 38)" stroke="#13294B" stroke-width="1.5" fill="none" opacity=".4"/><line x1="190" y1="130" x2="230" y2="95" stroke="#13294B" stroke-width="1.5"/><circle cx="230" cy="95" r="3" fill="#D4A017"/><path d="M35 75 C35 75 50 50 75 55" stroke="#D4A017" stroke-width="1.5" fill="none" opacity=".5"/><text x="120" y="95" font-family="serif" font-size="10" fill="#13294B" opacity=".3" transform="rotate(0 120 95)">△</text></svg>',
  calculus: '<svg viewBox="0 0 280 150" fill="none"><rect width="280" height="150" rx="16" fill="#FAF7F0"/><line x1="35" y1="75" x2="245" y2="75" stroke="#13294B" stroke-width="1" opacity=".15"/><path d="M40 90 C60 95 80 40 100 35 C120 30 140 110 160 105 C180 100 200 50 220 45 C240 40 250 60 255 70" stroke="#D4A017" stroke-width="2.5" fill="none"/><rect x="80" y="35" width="40" height="40" rx="4" fill="#13294B" fill-opacity=".04" stroke="#13294B" stroke-width="1" opacity=".15"/><text x="85" y="60" font-family="serif" font-size="11" fill="#13294B" opacity=".3">∫</text><path d="M60 20 L65 30 L55 30 Z" fill="#D4A017" opacity=".4"/><path d="M200 130 L205 120 L195 120 Z" fill="#D4A017" opacity=".4"/><circle cx="145" cy="70" r="3" fill="#13294B"/><line x1="145" y1="70" x2="145" y2="75" stroke="#D4A017" stroke-width="1.5"/><text x="140" y="68" font-family="monospace" font-size="8" fill="#D4A017">f\'</text><path d="M210 82 C220 87 230 82 235 78" stroke="#13294B" stroke-width="1" fill="none" opacity=".3"/></svg>'
};

async function refreshStudentData() {
  if (!currentUser) return;
  var [progR, attemptsR, finalR] = await Promise.all([
    sb.from('progress').select('*').eq('user_id', currentUser.id),
    sb.from('exam_attempts').select('*').eq('user_id', currentUser.id).order('created_at'),
    sb.from('final_exam_attempts').select('*').eq('user_id', currentUser.id).maybeSingle()
  ]);
  Progress = {};
  if (progR.data) progR.data.forEach(function(p) {
    Progress[p.lesson_id] = {
      hwScore: p.hw_score, hwResult: p.hw_result,
      completed: p.exam_completed, score: p.exam_score,
      lastResult: p.exam_result,
      lastAttempt: p.updated_at ? new Date(p.updated_at).getTime() : undefined,
      progress: p.exam_completed ? 100 : undefined, inProgress: false
    };
  });
  window._examAttempts = {};
  if (attemptsR.data) attemptsR.data.forEach(function(a) {
    if (!window._examAttempts[a.lesson_id]) window._examAttempts[a.lesson_id] = [];
    window._examAttempts[a.lesson_id].push(a);
  });
  window._finalExam = finalR.data || null;
}

async function renderCourses() {
  await refreshStudentData();
  const grid = document.getElementById('courses-grid');
  if (!grid) return;
  const filterEl = document.getElementById('courses-filter');
  const userLevel = userProfile?.level || null;
  const filtered = userLevel ? COURSES.filter(c => c.level === userLevel) : COURSES;
  if (filterEl) {
    if (currentUser && userLevel) {
      filterEl.innerHTML = '<span class="active-level">' + userLevel.replace('sec','Sec ') + '</span>';
    } else if (!currentUser) {
      filterEl.innerHTML = '<span style="font-size:.8125rem;color:var(--muted)">Sign in to see courses for your level</span>';
    } else {
      filterEl.innerHTML = '<span style="font-size:.8125rem;color:var(--muted)">Set your level in Profile</span>';
    }
  }
  grid.innerHTML = (filtered.length ? filtered : COURSES).map(c => {
    const tot = c.lessons.length;
    const done = c.lessons.filter(l => Progress[l.id]?.completed).length;
    const pct = tot > 0 ? Math.round(done / tot * 100) : 0;
    var thumbKey = 'algebra';
    var t = (c.title + ' ' + (c.desc||'')).toLowerCase();
    if (t.includes('trig') || t.includes('sine') || t.includes('cosine') || t.includes('tan')) thumbKey = 'trig';
    else if (t.includes('geom') || t.includes('angle') || t.includes('triangle') || t.includes('ruler') || t.includes('compass')) thumbKey = 'geometry';
    else if (t.includes('calc') || t.includes('deriv') || t.includes('integr') || t.includes('limit')) thumbKey = 'calculus';
    var thumbSvg = _courseThumbSvgs[thumbKey];
    var thumbHtml = c.img ? '<img src="' + esc(c.img) + '" alt="' + esc(c.title) + '">' : thumbSvg;
    var updatedLabel = '';
    if (c.updated_at) {
      var d = new Date(c.updated_at);
      var now = new Date();
      var diffMs = now - d;
      var diffDays = Math.floor(diffMs / 86400000);
      if (diffDays === 0) updatedLabel = 'Updated today';
      else if (diffDays === 1) updatedLabel = 'Updated yesterday';
      else if (diffDays < 7) updatedLabel = 'Updated ' + diffDays + ' days ago';
      else if (diffDays < 30) updatedLabel = 'Updated ' + Math.floor(diffDays / 7) + ' weeks ago';
      else updatedLabel = 'Updated ' + d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    }
    return '<div class="pc-card" onclick="toggleCourse(this)">'
      + '<div class="pc-thumb">' + thumbHtml + '</div>'
      + '<div class="pc-body">'
      + '<div class="pc-badge">' + tot + ' Lesson' + (tot !== 1 ? 's' : '') + '</div>'
      + '<h2 class="pc-title">' + esc(c.title) + '</h2>'
      + '<p class="pc-desc">' + esc(c.desc) + '</p>'
      + '<div class="pc-meta"><span>&#128196; ' + tot + ' Lesson' + (tot !== 1 ? 's' : '') + '</span><span>&#128260; ' + updatedLabel + '</span></div>'
      + '</div>'
      + '<div class="pc-right">'
      + '<div class="pc-progress-row"><span class="pc-progress-lbl">Progress</span><span class="pc-progress-pct">' + pct + '%</span></div>'
      + '<div class="pc-progress-bar"><div class="pc-progress-fill" style="width:' + pct + '%"></div></div>'
      + '<button class="pc-expand" onclick="event.stopPropagation();toggleCourse(this.closest(\'.pc-card\'))" aria-label="Toggle expand"><span class="pc-expand-icon">&#9660;</span></button>'
      + '</div>'
      + '<div class="pc-sections">' + lessonsHTML(c) + '</div></div>';
  }).join('');
}

function lessonsHTML(c) {
  let h = '<div class="course-sections-head">Lessons</div>';
  c.lessons.forEach(l => {
    const p = Progress[l.id];
    const idx = c.lessons.indexOf(l);
    const unlocked = idx === 0 || Progress[c.lessons[idx-1]?.id]?.completed;
    const lid = l.id;
    const types = new Set();
    const fileTypes = new Set();
    l.شرح.forEach(s => {
      types.add(s.type);
      if (s.pdf_url) fileTypes.add('PDF');
      if (s.file_url) {
        var ext = s.file_url.split('.').pop().toLowerCase();
        var label = { pdf: 'PDF', doc: 'Word', docx: 'Word', ppt: 'PPT', pptx: 'PPT', txt: 'Text', zip: 'ZIP' }[ext];
        if (label) fileTypes.add(label);
      }
    });
    types.add('Worksheet');
    types.add('Exam');
    const typeBadges = Array.from(types).map(t => '<span class="cs-type cs-' + t.toLowerCase() + '">' + t + '</span>').join(' ');
    const fileBadges = Array.from(fileTypes).map(t => '<span class="cs-type cs-file cs-' + t.toLowerCase() + '">' + t + '</span>').join(' ');
    h += '<div class="lesson-row ' + (p?.completed ? 'done' : '') + ' ' + (unlocked ? '' : 'locked') + '" data-lid="' + lid + '" onclick="' + (unlocked ? 'event.stopPropagation();toggleLessonContent(' + lid + ')' : 'event.stopPropagation()') + '">';
    h += '<div class="lr-icon">' + (p?.completed ? '&#10003;' : unlocked ? lid : '&#128274;') + '</div>';
    h += '<div class="lr-body"><div class="lr-title">' + esc(l.title) + ' ' + typeBadges + ' ' + fileBadges + '</div><div class="lr-meta">' + esc(l.topic) + (p?.score != null ? ' | ' + p.score + '%' : '') + '</div></div>';
    h += '<span class="lr-arrow">' + (unlocked ? '&#9660;' : '') + '</span>';
    h += '</div>';
    if (unlocked) {
      h += '<div class="ls-content" id="ls-' + lid + '">';
      h += '<div class="cs-group"><div class="cs-group-head">Lecture</div>';
      h += l.شرح.map(s => {
        var sFileSet = new Set();
        if (s.pdf_url) sFileSet.add('PDF');
        if (s.file_url) {
          var sext = s.file_url.split('.').pop().toLowerCase();
          var slabel = { pdf: 'PDF', doc: 'Word', docx: 'Word', ppt: 'PPT', pptx: 'PPT', txt: 'Text', zip: 'ZIP' }[sext];
          if (slabel) sFileSet.add(slabel);
        }
        var sFileBadges = Array.from(sFileSet).map(function(t) { return '<span class="cs-type cs-file cs-' + t.toLowerCase() + '">' + t + '</span>'; }).join('');
        return '<div class="course-section-row" onclick="event.stopPropagation();showContent(' + lid + ',\'شرح\',\'' + esc(s.title) + '\')"><span class="cs-num">' + (l.شرح.indexOf(s)+1) + '</span><span class="cs-title">' + esc(s.title) + sFileBadges + '</span><span class="cs-type cs-' + esc(s.type.toLowerCase()) + '">' + esc(s.type) + '</span><span class="cs-open">Open &rarr;</span></div>';
      }).join('');
      h += '</div><div class="cs-group"><div class="cs-group-head">Homework</div>';
      const hwDone = Progress[lid]?.hwScore != null;
      var hwTotal = l.واجب.questions.length + l.واجب.imageQuestions.length;
      h += '<div class="course-section-row" onclick="event.stopPropagation();' + (hwDone ? 'viewHW(' + lid + ')' : 'startHW(' + lid + ')') + '"><span class="cs-num">' + (hwDone ? '&#10003;' : '&#9733;') + '</span><span class="cs-title">' + hwTotal + ' questions' + (hwDone ? ' | Score: ' + Progress[lid]?.hwScore + '%' : '') + '</span><span class="cs-type cs-worksheet">Worksheet</span><span class="cs-open">' + (hwDone ? 'View Result' : 'Start') + ' &rarr;</span></div>';
      h += '</div><div class="cs-group"><div class="cs-group-head">Exam</div>';
      var isDynamic = l.امتحان.totalQuestions > 0;
      var examDone = Progress[lid]?.completed;
      var attempts = (window._examAttempts || {})[lid] || [];
      var attemptCount = attempts.length;
      var hasFinalDone = window._finalExam && window._finalExam.lesson_id === lid;
      if (isDynamic) {
        // Show each attempt row
        if (attemptCount > 0) {
          attempts.forEach(function(a, ai) {
            var aPct = a.total > 0 ? Math.round(a.score / a.total * 100) : 0;
            var aPassed = aPct >= l.امتحان.attemptPassScore;
            h += '<div class="course-section-row exam" onclick="event.stopPropagation();viewExamAttempt(' + lid + ',' + a.id + ')"><span class="cs-num">' + (aPassed ? '&#10003;' : '&#10007;') + '</span><span class="cs-title">Attempt ' + a.attempt_number + '/' + l.امتحان.maxAttempts + ' — ' + aPct + '%' + (aPassed ? ' Passed' : ' Failed') + '</span><span class="cs-type cs-exam">Attempt</span><span class="cs-open">View &rarr;</span></div>';
          });
        }
        // Show "Start Next Attempt" if attempts remain
        if (attemptCount < l.امتحان.maxAttempts && !examDone) {
          var qpa = l.امتحان.questionsPerAttempt > 0 ? l.امتحان.questionsPerAttempt : Math.floor(l.امتحان.totalQuestions / Math.max(1, l.امتحان.maxAttempts));
          if (qpa <= 0) qpa = 10;
          h += '<div class="course-section-row exam" onclick="event.stopPropagation();startDynamicExam(' + lid + ')"><span class="cs-num">&#9733;</span><span class="cs-title">Attempt ' + (attemptCount + 1) + '/' + l.امتحان.maxAttempts + ' — ' + l.امتحان.totalQuestions + 'q pool · ' + qpa + ' per round</span><span class="cs-type cs-exam">Exam</span><span class="cs-open" style="color:var(--success)">Start &rarr;</span></div>';
        } else if (examDone) {
          h += '<div class="course-section-row exam" style="opacity:.6"><span class="cs-num">&#10003;</span><span class="cs-title">All attempts used — course completed</span><span class="cs-type cs-exam">Done</span></div>';
        }
        // Show final exam if enabled and not yet done
        if (l.امتحان.hasFinalExam && attemptCount >= l.امتحان.maxAttempts && !hasFinalDone) {
          h += '<div class="course-section-row exam" onclick="event.stopPropagation();startFinalExam(' + lid + ')"><span class="cs-num">&#9733;</span><span class="cs-title">📋 Final Exam — comprehensive review</span><span class="cs-type cs-exam">Final</span><span class="cs-open" style="color:var(--success)">Start &rarr;</span></div>';
        }
        if (hasFinalDone) {
          var fPct = window._finalExam.total > 0 ? Math.round(window._finalExam.score / window._finalExam.total * 100) : 0;
          h += '<div class="course-section-row exam" style="opacity:.6"><span class="cs-num">&#10003;</span><span class="cs-title">Final Exam — ' + fPct + '%</span><span class="cs-type cs-exam">Final</span></div>';
        }
      } else if (examDone) {
        var examTotal = l.امتحان.questions.length + l.امتحان.imageQuestions.length;
        h += '<div class="course-section-row exam" onclick="event.stopPropagation();viewExam(' + lid + ')"><span class="cs-num">&#10003;</span><span class="cs-title">' + examTotal + ' questions - Pass: ' + l.امتحان.passScore + '% | Score: ' + Progress[lid]?.score + '%</span><span class="cs-type cs-exam">Exam</span><span class="cs-open" style="color:var(--success)">View Result &rarr;</span></div>';
      } else {
        var examTotal = l.امتحان.questions.length + l.امتحان.imageQuestions.length;
        h += '<div class="course-section-row exam" onclick="event.stopPropagation();startExam(' + lid + ')"><span class="cs-num">&#9733;</span><span class="cs-title">' + examTotal + ' questions - Pass: ' + l.امتحان.passScore + '%</span><span class="cs-type cs-exam">Exam</span><span class="cs-open" style="color:var(--success)">Start &rarr;</span></div>';
      }
      h += '</div>';
      h += '<div class="cs-group"><div class="cs-group-head">Community</div><div class="course-section-row" onclick="event.stopPropagation();showTopCommunityQuestions(' + lid + ',\'' + esc(l.title) + '\')"><span class="cs-num">&#9733;</span><span class="cs-title">Top questions from students about this lesson</span><span class="cs-type cs-community">Community</span><span class="cs-open">View &rarr;</span></div></div>';
      h += '</div>';
    }
  });
  return h;
}

function toggleCourse(card) {
  const was = card.classList.contains('open');
  document.querySelectorAll('.pc-card.open').forEach(c => c.classList.remove('open'));
  if (!was) card.classList.add('open');
}

function toggleLessonContent(id) {
  const el = document.getElementById('ls-' + id);
  if (!el) return;
  const wasOpen = el.classList.contains('open');
  document.querySelectorAll('.ls-content.open').forEach(c => c.classList.remove('open'));
  if (!wasOpen) el.classList.add('open');
}

function startHW(lid) {
  if (!currentUser) { alert('Please log in to start homework.'); return; }
  currentLessonId = lid;
  startQuiz(lid, 'hw');
}

function startExam(lid) {
  if (!currentUser) { alert('Please log in to start the exam.'); return; }
  currentLessonId = lid;
  var found = getLesson(lid);
  if (found && found.lesson.امتحان.totalQuestions > 0) {
    startDynamicExam(lid);
    return;
  }
  startQuiz(lid, 'exam');
}

function showContent(id, group, title) {
  if (!currentUser) { alert('Please log in to view content.'); return; }
  const found = getLesson(id);
  if (!found) return;
  const l = found.lesson;
  const items = l.شرح;
  const item = items.find(s => s.title === title);
  if (!item) return;
  currentLessonId = id;
  if (!Progress[id]) Progress[id] = {};
  if (!Progress[id].completed && !Progress[id].inProgress) {
    Progress[id].inProgress = true;
    Progress[id].progress = 25;
    saveProgress();
  }
  showView('content', { lesson: l, course: found.course, item, group });
}

async function renderContentPage(data) {
  const { lesson: l, course: c, item, group } = data;
  document.getElementById('content-breadcrumb').textContent = c.title + ' / ' + l.title + ' / ' + group;
  const el = document.getElementById('content-page');
  const groupLabel = group === 'شرح' ? 'Lecture' : 'Homework';
  const typeTag = item.type ? '<span class="cs-type cs-' + item.type.toLowerCase() + '">' + item.type + '</span>' : '';
  let content = '<div class="lesson-content"><h2>' + l.title + '</h2>';
  content += '<p class="lesson-topic-header">' + l.topic + ' &middot; ' + groupLabel + ' &middot; ' + typeTag + '</p>';
  if (item.type === 'Video' && item.video_url) {
    const v = item.video_url;
    if (v.includes('youtube.com') || v.includes('youtu.be')) {
      const id = v.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]+)/)?.[1];
      content += '<div class="video-container" style="background:#000"><iframe class="video-player" src="https://youtube.com/embed/' + id + '?rel=0&modestbranding=1&playsinline=1" allow="autoplay; encrypted-media; fullscreen" allowfullscreen loading="lazy"></iframe></div>';
    } else if (v.includes('vimeo.com')) {
      const id = v.match(/vimeo\.com\/(\d+)/)?.[1];
      content += '<div class="video-container" style="background:#000"><iframe class="video-player" src="https://player.vimeo.com/video/' + id + '?playsinline=1" allow="autoplay; encrypted-media; fullscreen" allowfullscreen loading="lazy"></iframe></div>';
    } else {
      content += '<div class="vp-wrap" id="vp-' + Date.now() + '">' +
'<div class="vp-loading"><span class="vp-spinner"></span>Loading video\u2026</div>' +
'<video class="vp-video" playsinline preload="metadata" oncontextmenu="return false"></video>' +
'<div class="vp-controls"><div class="vp-ctrl-bg"></div>' +
'<div class="vp-timeline-wrap"><div class="vp-timeline" onclick="vpSeek(event,this)"><div class="vp-track"><div class="vp-buffer"></div><div class="vp-progress"></div></div><div class="vp-thumb"></div></div></div>' +
'<div class="vp-bottom"><div class="vp-left">' +
'<button class="vp-btn vp-play-btn" onclick="vpToggle(this)" aria-label="Play"><svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><polygon points="6,4 20,12 6,20"/></svg></button>' +
'<span class="vp-time"><span class="vp-current">0:00</span><span class="vp-sep">/</span><span class="vp-duration">0:00</span></span></div>' +
'<div class="vp-right">' +
'<div class="vp-speed-wrap"><button class="vp-btn vp-speed-btn" onclick="event.stopPropagation();this.parentNode.classList.toggle(\'vp-sp-open\')" aria-label="Speed">1\u00D7</button>' +
'<div class="vp-speed-menu"><button class="vp-sp-opt" data-speed="0.5">0.5\u00D7</button><button class="vp-sp-opt" data-speed="0.75">0.75\u00D7</button><button class="vp-sp-opt vp-sp-active" data-speed="1">1\u00D7</button><button class="vp-sp-opt" data-speed="1.25">1.25\u00D7</button><button class="vp-sp-opt" data-speed="1.5">1.5\u00D7</button><button class="vp-sp-opt" data-speed="2">2\u00D7</button></div></div>' +
'<div class="vp-quality-wrap"><button class="vp-btn vp-quality-btn" onclick="event.stopPropagation();this.parentNode.classList.toggle(\'vp-q-open\')" aria-label="Quality"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><polyline points="6 9 12 15 18 9"/></svg></button>' +
'<div class="vp-quality-menu"></div></div>' +
'<div class="vp-volume-wrap"><button class="vp-btn vp-volume-btn" onclick="vpToggleMute(this)" aria-label="Volume"><svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg></button>' +
'<div class="vp-volume-slider"><input type="range" min="0" max="1" step="0.05" value="1" oninput="vpSetVolume(this,event)"></div></div>' +
'<button class="vp-btn vp-fs-btn" onclick="vpFullscreen(this)" aria-label="Fullscreen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg></button>' +
'<button class="vp-btn vp-help-btn" onclick="event.stopPropagation();vpShowHelp(this)" aria-label="Keyboard shortcuts"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></button>' +
'</div></div></div></div>';
content += '<div class="vp-help-overlay" id="vp-help-' + Date.now() + '" style="display:none"><div class="vp-help-box"><div class="vp-help-title">Keyboard Shortcuts</div><div class="vp-help-grid"><div class="vp-help-row"><span class="vp-help-key">Space</span><span>Play / Pause</span></div><div class="vp-help-row"><span class="vp-help-key">\u2190</span><span>Rewind 10s</span></div><div class="vp-help-row"><span class="vp-help-key">\u2192</span><span>Forward 10s</span></div><div class="vp-help-row"><span class="vp-help-key">\u2191</span><span>Volume up</span></div><div class="vp-help-row"><span class="vp-help-key">\u2193</span><span>Volume down</span></div><div class="vp-help-row"><span class="vp-help-key">F</span><span>Fullscreen</span></div><div class="vp-help-row"><span class="vp-help-key">M</span><span>Mute</span></div><div class="vp-help-row"><span class="vp-help-key">?</span><span>Show shortcuts</span></div></div><button class="vp-help-close" onclick="vpHideHelp(this)">Got it</button></div></div>';
    }
  }
  if (item.type === 'Image' && item.image_url) {
    content += '<div style="text-align:center;margin:20px 0"><img src="' + esc(item.image_url) + '" style="max-width:100%;border-radius:12px;border:1px solid var(--border);box-shadow:0 2px 12px rgba(0,0,0,0.08)" alt="' + esc(item.title) + '" loading="lazy"></div>';
  }
  if (item.type === 'Video' && !item.video_url) {
    content += '<div id="enc-video-container" class="video-container" style="background:#000;min-height:200px;display:flex;align-items:center;justify-content:center"><div style="color:var(--muted)">Encrypted video loading...</div></div>';
  }
  content += '<div class="lesson-step"><h3>' + item.title + '</h3><p>' + item.content + '</p>' + (item.math ? '<div class="math-block">$$' + esc(item.math) + '$$</div>' : '') + '</div>';
  if (item.file_url) {
    var fn = item.file_url.split('/').pop();
    content += '<div class="file-download"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg><div class="fd-body"><a class="fd-link" href="' + esc(item.file_url) + '" target="_blank" rel="noopener noreferrer" download>' + esc(fn) + '</a><span class="fd-hint">Click to open or download</span></div></div>';
  }
  if (item.pdf_url) {
    var pfn = item.pdf_url.split('/').pop();
    content += '<div class="pdf-section"><div class="pdf-header"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15h6"/><path d="M12 12v6"/></svg><span>PDF Material</span><a class="pdf-dl-btn" href="' + esc(item.pdf_url) + '" target="_blank" rel="noopener noreferrer" download title="Download PDF"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></a></div><div class="pdf-viewer"><iframe src="' + esc(item.pdf_url) + '#toolbar=0" class="pdf-iframe" loading="lazy" title="PDF Viewer"></iframe></div></div>';
  }
  content += '<div class="lesson-nav"><button class="btn btn-ghost" onclick="showView(\'courses\')">&larr; Back to Courses</button></div></div>';
  el.innerHTML = content;
  if (typeof renderMathInElement === 'function') renderMathInElement(el, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '\\(', right: '\\)', display: false }] });
  if (item.type === 'Video') {
    if (item.video_url) {
      const v = item.video_url;
      if (!v.includes('youtube.com') && !v.includes('youtu.be') && !v.includes('vimeo.com')) {
        vpInit(v, el.querySelector('.vp-wrap'));
      }
    } else {
      const encContainer = document.getElementById('enc-video-container');
      if (encContainer) playEncryptedVideo(l.id, encContainer);
    }
  }
}

// ========== Custom Video Player ==========
function vpInit(src, wrap) {
  if (!wrap) return;
  var video = wrap.querySelector('.vp-video');
  var loading = wrap.querySelector('.vp-loading');
  var ctrl = wrap.querySelector('.vp-controls');
  var prog = wrap.querySelector('.vp-progress');
  var buf = wrap.querySelector('.vp-buffer');
  var thumb = wrap.querySelector('.vp-thumb');
  var curEl = wrap.querySelector('.vp-current');
  var durEl = wrap.querySelector('.vp-duration');
  var playBtn = wrap.querySelector('.vp-play-btn');
  var qMenu = wrap.querySelector('.vp-quality-menu');
  var volumeSlider = wrap.querySelector('.vp-volume-slider input');
  var volBtn = wrap.querySelector('.vp-volume-btn');
  // Parse source
  var sources = [];
  try { var parsed = JSON.parse(src); if (typeof parsed === 'object') { for (var k in parsed) sources.push({ label: k, src: parsed[k] }); } } catch(e) {}
  if (sources.length === 0) sources.push({ label: 'Auto', src: src });
  sources.sort(function(a,b) { var n = parseInt(b.label); var o = parseInt(a.label); return isNaN(n)||isNaN(o) ? 0 : n-o; });
  var currentSrcIdx = 0;
  function buildQualityMenu() {
    if (sources.length < 2) { qMenu.parentNode.style.display = 'none'; return; }
    qMenu.innerHTML = '';
    sources.forEach(function(s, i) {
      var opt = document.createElement('button');
      opt.textContent = s.label;
      opt.className = 'vp-q-opt' + (i === currentSrcIdx ? ' vp-q-active' : '');
      opt.onclick = function(e) { e.stopPropagation(); switchQuality(i); };
      qMenu.appendChild(opt);
    });
  }
  function switchQuality(idx) {
    if (idx === currentSrcIdx) return;
    var wasPlaying = !video.paused;
    var ct = video.currentTime;
    currentSrcIdx = idx;
    video.src = sources[idx].src;
    video.currentTime = ct;
    if (wasPlaying) video.play().catch(function(){});
    qMenu.querySelectorAll('.vp-q-opt').forEach(function(el, i) { el.classList.toggle('vp-q-active', i === idx); });
    wrap.querySelector('.vp-quality-btn').textContent = sources[idx].label;
  }
  function formatTime(s) {
    if (isNaN(s) || !isFinite(s)) return '0:00';
    var m = Math.floor(s / 60);
    var sec = Math.floor(s % 60);
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }
  function updateProgress() {
    if (!video.duration) return;
    var pct = (video.currentTime / video.duration) * 100;
    prog.style.width = pct + '%';
    thumb.style.left = pct + '%';
    curEl.textContent = formatTime(video.currentTime);
    durEl.textContent = formatTime(video.duration);
  }
  function updateBuffer() {
    if (!video.buffered.length || !video.duration) return;
    var end = video.buffered.end(video.buffered.length - 1);
    buf.style.width = (end / video.duration * 100) + '%';
  }
  function setLoading(st) {
    loading.style.display = st ? '' : 'none';
    if (!st) { wrap.classList.add('vp-ready'); ctrl.style.display = ''; }
  }
  function showError() {
    loading.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="32" height="32" style="margin-bottom:8px;opacity:.6"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>Video unavailable';
  }
  // Get URL
  var srcUrl = sources[currentSrcIdx].src;
  async function initVideo() {
    try {
      var url = srcUrl;
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        var { data: signed } = await sb.storage.from('videos').createSignedUrl(url, 3600);
        if (!signed) throw new Error('No signed URL');
        url = signed.signedUrl;
      }
      video.src = url;
      setLoading(false);
    } catch(e) { setLoading(false); showError(); }
  }
  initVideo();
  buildQualityMenu();
  // Events
  video.addEventListener('timeupdate', updateProgress);
  video.addEventListener('progress', updateBuffer);
  video.addEventListener('loadedmetadata', function() {
    durEl.textContent = formatTime(video.duration);
    curEl.textContent = '0:00';
  });
  video.addEventListener('play', function() { playBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'; });
  video.addEventListener('pause', function() { playBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><polygon points="6,4 20,12 6,20"/></svg>'; });
  video.addEventListener('waiting', function() { setLoading(true); });
  video.addEventListener('canplay', function() { setLoading(false); });
  video.addEventListener('error', function() { showError(); });
  // Click zones: left=rewind 10s, center=play/pause, right=forward 10s
  wrap.addEventListener('click', function(e) {
    if (e.target.closest('.vp-controls') || e.target.closest('.vp-help-overlay')) return;
    var rect = wrap.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var zone = x / rect.width;
    if (zone < 0.33) { video.currentTime = Math.max(0, video.currentTime - 10); }
    else if (zone > 0.66) { video.currentTime = Math.min(video.duration || 0, video.currentTime + 10); }
    else { vpToggle(playBtn); }
  });
  // Speed control
  wrap.querySelectorAll('.vp-sp-opt').forEach(function(el) {
    el.addEventListener('click', function(e) {
      e.stopPropagation();
      var speed = parseFloat(this.dataset.speed);
      video.playbackRate = speed;
      wrap.querySelector('.vp-speed-btn').textContent = speed + '\u00D7';
      wrap.querySelectorAll('.vp-sp-opt').forEach(function(o) { o.classList.remove('vp-sp-active'); });
      this.classList.add('vp-sp-active');
      wrap.querySelector('.vp-speed-wrap').classList.remove('vp-sp-open');
    });
  });
  // Keyboard shortcuts
  var kbdHandler = function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    var key = e.key.toLowerCase();
    if (key === ' ' || key === 'space') { e.preventDefault(); vpToggle(playBtn); }
    else if (key === 'arrowleft') { video.currentTime = Math.max(0, video.currentTime - 10); }
    else if (key === 'arrowright') { video.currentTime = Math.min(video.duration || 0, video.currentTime + 10); }
    else if (key === 'arrowup') { e.preventDefault(); var v = Math.min(1, video.volume + 0.1); video.volume = v; video.muted = false; var vs = wrap.querySelector('.vp-volume-slider input'); if (vs) vs.value = v; }
    else if (key === 'arrowdown') { e.preventDefault(); var v = Math.max(0, video.volume - 0.1); video.volume = v; if (v === 0) video.muted = true; var vs = wrap.querySelector('.vp-volume-slider input'); if (vs) vs.value = v; }
    else if (key === 'f') { vpFullscreen(playBtn); }
    else if (key === 'm') { vpToggleMute(playBtn); }
    else if (key === '?') { vpShowHelp(playBtn); }
  };
  document.addEventListener('keydown', kbdHandler);
  // Show/hide controls on hover
  var hideTimer;
  wrap.addEventListener('mousemove', function() {
    ctrl.classList.add('vp-visible');
    clearTimeout(hideTimer);
    if (!video.paused) hideTimer = setTimeout(function() { ctrl.classList.remove('vp-visible'); }, 3000);
  });
  wrap.addEventListener('mouseleave', function() {
    if (!video.paused && !wrap.querySelector('.vp-help-overlay:not([style*=\"display:none\"])')) ctrl.classList.remove('vp-visible');
  });
  video.addEventListener('play', function() { clearTimeout(hideTimer); });
  video.addEventListener('pause', function() { ctrl.classList.add('vp-visible'); });
  // Cleanup keyboard handler when player is destroyed
  wrap._cleanup = function() { document.removeEventListener('keydown', kbdHandler); };
}
function vpToggle(btn) {
  var wrap = btn.closest('.vp-wrap') || btn.closest('.vp-help-overlay') && document.querySelector('.vp-wrap');
  if (!wrap) return;
  var video = wrap.querySelector('.vp-video');
  if (!video) return;
  if (video.paused) video.play().catch(function(){}); else video.pause();
}
function vpSeek(e, timeline) {
  var wrap = timeline.closest('.vp-wrap');
  var video = wrap.querySelector('.vp-video');
  var rect = timeline.getBoundingClientRect();
  var pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  video.currentTime = pct * video.duration;
}
function vpToggleMute(btn) {
  var wrap = btn.closest('.vp-wrap');
  var video = wrap.querySelector('.vp-video');
  var slider = wrap.querySelector('.vp-volume-slider input');
  video.muted = !video.muted;
  slider.value = video.muted ? 0 : (video.volume || 1);
}
function vpSetVolume(slider) {
  var wrap = slider.closest('.vp-wrap');
  var video = wrap.querySelector('.vp-video');
  video.volume = parseFloat(slider.value);
  video.muted = false;
  if (video.volume === 0) video.muted = true;
}
function vpFullscreen(btn) {
  var wrap = btn.closest('.vp-wrap');
  if (document.fullscreenElement) document.exitFullscreen();
  else wrap.requestFullscreen().catch(function(){});
}
function vpShowHelp(btn) {
  var overlay = document.querySelector('.vp-help-overlay');
  if (overlay) overlay.style.display = 'flex';
}
function vpHideHelp(btn) {
  var overlay = btn.closest('.vp-help-overlay');
  if (overlay) overlay.style.display = 'none';
}

function startQuiz(lessonId, type) {
  const found = getLesson(lessonId);
  if (!found) return;
  currentLessonId = lessonId;
  if (!Progress[lessonId]) Progress[lessonId] = {};
  var qs = type === 'exam' ? found.lesson.امتحان.questions : found.lesson.واجب.questions;
  qs = (qs || []).slice();
  var imgQs = type === 'exam' ? found.lesson.امتحان.imageQuestions : found.lesson.واجب.imageQuestions;
  if (imgQs) {
    imgQs.forEach(function(iq) {
      var letterIndex = iq.correct === 'A' ? 0 : iq.correct === 'B' ? 1 : iq.correct === 'C' ? 2 : iq.correct === 'D' ? 3 : 0;
      qs.push({ q: '', opts: ['A', 'B', 'C', 'D'], correct: letterIndex, math: '', image_url: '', option_images: iq.option_images || [], isImage: true, imgQ: iq.imgQ, explanation: iq.explanation, explanation_image_url: iq.explanation_image_url || '' });
    });
  }
  quizState = { lessonId, type, questions: qs, total: qs.length, answers: new Array(qs.length).fill(-1), submitted: false };
  const label = document.getElementById('quiz-type-label');
  if (label) label.textContent = type === 'exam' ? 'Exam' : 'Homework';
  const bar = document.getElementById('quiz-bar');
  const txt = document.getElementById('quiz-progress-text');
  if (bar) bar.style.width = '0%';
  if (txt) txt.textContent = '0/' + qs.length;
  if (type === 'exam') startTimer(found.lesson.امتحان.timeLimit || 20);
  showView('quiz');
  renderAllQuestions();
}

function renderAllQuestions() {
  if (!quizState) return;
  const { questions, total, answers, submitted } = quizState;
  const answered = answers.filter(a => a >= 0).length;
  const bar = document.getElementById('quiz-bar');
  const txt = document.getElementById('quiz-progress-text');
  if (bar) bar.style.width = (answered / total * 100) + '%';
  if (txt) txt.textContent = answered + '/' + total;
  const SU = 'https://usllnkoqqpfynsiprvqh.supabase.co/storage/v1/object/public/question-images/';
  let html = questions.map((q, qi) => {
    if (q.isImage) {
      var imgUrl = SU + q.imgQ;
      var optHtml = q.opts.map(function(o, oi) {
        var sel = answers[qi] === oi ? ' selected' : '';
        var optImg = q.option_images?.[oi] ? '<img src="' + SU + q.option_images[oi] + '" style="max-width:60px;max-height:60px;vertical-align:middle;margin-right:6px;border-radius:4px;border:1px solid var(--border)">' : '';
        return '<div class="quiz-option' + sel + '" data-qi="' + qi + '" data-oi="' + oi + '" onclick="selectAnswer(' + qi + ',' + oi + ')">' + optImg + o + '</div>';
      }).join('');
      return '<div class="quiz-question"><div class="q-number">Question ' + (qi+1) + ' of ' + total + '</div><div style="text-align:center;margin:12px 0"><img src="' + imgUrl + '" style="max-width:100%;border-radius:var(--radius);border:1px solid var(--border);cursor:zoom-in" onclick="window.open(this.src)"></div><div class="quiz-options" style="grid-template-columns:repeat(2,1fr)">' + optHtml + '</div></div>';
    }
    const imgHtml = q.image_url ? '<div style="text-align:center;margin:8px 0"><img src="' + SU + q.image_url + '" style="max-width:100%;max-height:200px;border-radius:var(--radius);border:1px solid var(--border)"></div>' : '';
    const opts = q.opts.map((o, oi) => {
      const sel = answers[qi] === oi ? ' selected' : '';
      const optImg = q.option_images?.[oi] ? '<img src="' + SU + q.option_images[oi] + '" style="max-width:60px;max-height:60px;vertical-align:middle;margin-right:6px;border-radius:4px;border:1px solid var(--border)">' : '';
      return '<div class="quiz-option' + sel + '" data-qi="' + qi + '" data-oi="' + oi + '" onclick="selectAnswer(' + qi + ',' + oi + ')">' + optImg + o + '</div>';
    }).join('');
    return '<div class="quiz-question"><div class="q-number">Question ' + (qi+1) + ' of ' + total + '</div><h2>' + q.q + '</h2>' + imgHtml + (q.math ? '<div class="math-block">$$' + esc(q.math) + '$$</div>' : '') + '<div class="quiz-options">' + opts + '</div></div>';
  }).join('');
  const btn = submitted ? '' : '<button class="btn btn-primary" onclick="submitAll()" style="width:100%;justify-content:center">Submit Answers</button>';
  document.getElementById('quiz-content').innerHTML = html + '<div class="quiz-actions" style="margin-top:24px">' + btn + '</div>';
  if (typeof renderMathInElement === 'function') renderMathInElement(document.getElementById('quiz-content'), { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '\\(', right: '\\)', display: false }] });
}

function selectAnswer(qi, oi) {
  if (!quizState || quizState.submitted) return;
  quizState.answers[qi] = oi;
  document.querySelectorAll('.quiz-option[data-qi="' + qi + '"]').forEach(el => el.classList.remove('selected'));
  document.querySelector('.quiz-option[data-qi="' + qi + '"][data-oi="' + oi + '"]').classList.add('selected');
  const answered = quizState.answers.filter(a => a >= 0).length;
  const bar = document.getElementById('quiz-bar');
  const txt = document.getElementById('quiz-progress-text');
  if (bar) bar.style.width = (answered / quizState.total * 100) + '%';
  if (txt) txt.textContent = answered + '/' + quizState.total;
}

// ── Exam Timer ──
var _examTimer = null;
var _examTimeLeft = 0;
function startTimer(minutes) {
  clearTimer();
  if (!minutes || minutes <= 0) { var t = document.getElementById('quiz-timer'); if (t) t.style.display = 'none'; return; }
  _examTimeLeft = minutes * 60;
  updateTimerDisplay();
  var el = document.getElementById('quiz-timer');
  if (el) el.style.display = '';
  _examTimer = setInterval(function() {
    _examTimeLeft--;
    updateTimerDisplay();
    if (_examTimeLeft <= 0) {
      clearTimer();
      submitAll();
    }
  }, 1000);
}
function clearTimer() {
  if (_examTimer) { clearInterval(_examTimer); _examTimer = null; }
  var el = document.getElementById('quiz-timer');
  if (el) el.style.display = 'none';
}
function updateTimerDisplay() {
  var el = document.getElementById('quiz-timer');
  if (!el) return;
  if (_examTimeLeft <= 0) { el.textContent = 'Time up!'; el.style.color = 'var(--error)'; return; }
  var m = Math.floor(_examTimeLeft / 60);
  var s = _examTimeLeft % 60;
  el.textContent = m + ':' + (s < 10 ? '0' : '') + s;
  if (_examTimeLeft <= 120) el.style.color = 'var(--error)';
  else el.style.color = '';
}

async function submitAll() {
  clearTimer();
  try {
  if (!quizState || quizState.submitted) return;
  quizState.submitted = true;
  let score = 0;
  const { lessonId, type, total, attemptId } = quizState;
  quizState.questions.forEach((q, i) => {
    if (quizState.answers[i] === parseInt(q.correct, 10)) score++;
  });
  const pct = Math.round(score / total * 100);
  const result = { answers: [...quizState.answers], score, total };
  if (type === 'review') {
    // Save seen question IDs for weekly rotation
    if (window._reviewWeekKey && window._reviewSeenIds) {
      quizState.questions.forEach(function(q) {
        if (q.qid && q.qtype) window._reviewSeenIds[q.qtype + '_' + q.qid] = true;
      });
      localStorage.setItem(window._reviewWeekKey, JSON.stringify(window._reviewSeenIds));
    }
    // Save latest review result to localStorage for instant display on review page
    var lsData = { score: score, total: total, time: Date.now() };
    // Compute per-lesson stats using questionOrder source_lesson_id + quizState.answers
    if (quizState.questionOrder) {
      var lsPerLesson = {};
      quizState.questionOrder.forEach(function(item, i) {
        var sl = item.source_lesson_id;
        if (!sl) return;
        if (!lsPerLesson[sl]) lsPerLesson[sl] = { lid: sl, cnt: 0, wrg: 0 };
        lsPerLesson[sl].cnt++;
        var ua = quizState.answers[i];
        if (ua === undefined || ua < 0) { lsPerLesson[sl].wrg++; return; }
        // Compare with correct answer from quizState.questions (parallel arrays)
        var qo = quizState.questions[i];
        if (qo && Number(ua) !== Number(qo.correct)) lsPerLesson[sl].wrg++;
        else if (!qo) lsPerLesson[sl].wrg++;
      });
      lsData.lessonStats = Object.keys(lsPerLesson).map(function(k) { return lsPerLesson[k]; });
    }
    try { localStorage.setItem('latestReview', JSON.stringify(lsData)); } catch(e) {}
    // Save to Supabase — await before navigation
    (async function() {
      try {
        if (quizState.questionOrder && currentUser) {
          var saved = await sb.from('exam_attempts').insert({
            user_id: currentUser.id, lesson_id: null,
            attempt_number: Date.now(), score: score, total: total,
            answers: { answers: quizState.answers, score: score, total: total, lessonStats: lsData.lessonStats },
            passed: false,
            question_order: quizState.questionOrder
          }).select();
          if (saved.data && saved.data[0]) {
            localStorage.setItem('latestReviewId', String(saved.data[0].id));
          }
        }
      } catch(e) { console.error('Save review failed:', e); }
    })();
    showView('review');
    return;
  }
  if (type === 'hw') {
    Progress[lessonId].hwScore = pct;
    Progress[lessonId].hwResult = result;
    saveProgress();
    renderReport(lessonId, type, quizState.questions, result);
  } else if (type === 'final') {
    // Final exam submission
    var passed = pct >= (getLesson(lessonId)?.lesson.امتحان.attemptPassScore || 60);
    (async function() {
      var { data: existing } = await sb.from('final_exam_attempts').select('id').eq('user_id', currentUser.id).eq('lesson_id', lessonId).maybeSingle();
      if (existing) {
        await sb.from('final_exam_attempts').update({ score: score, total: total, answers: result, passed: passed }).eq('id', existing.id);
      } else {
        await sb.from('final_exam_attempts').insert({ user_id: currentUser.id, lesson_id: lessonId, score: score, total: total, answers: result, passed: passed });
      }
    })();
    window._finalExam = { lesson_id: lessonId, score: score, total: total, passed: passed };
    if (!Progress[lessonId]) Progress[lessonId] = {};
    Progress[lessonId].completed = true;
    Progress[lessonId].progress = 100;
    Progress[lessonId].score = pct;
    Progress[lessonId].lastAttempt = Date.now();
    Progress[lessonId].lastResult = result;
    saveProgress();
    renderReport(lessonId, 'final', quizState.questions, result);
  } else {
    // Dynamic exam attempt submission
    if (attemptId) {
      var found = getLesson(lessonId);
      var attPass = found ? found.lesson.امتحان.attemptPassScore : 60;
      var passed = pct >= attPass;
      // Update local cache synchronously with correct attempt_number
      var oldEntry = (window._examAttempts[lessonId] || []).find(function(a) { return a.id === attemptId; });
      var actualAttNum = oldEntry ? oldEntry.attempt_number : ((window._examAttempts[lessonId] || []).length + 1);
      var atts = (window._examAttempts[lessonId] || []).filter(function(a) { return a.id !== attemptId; });
      atts.push({ id: attemptId, attempt_number: actualAttNum, score: score, total: total, passed: passed, answers: result });
      window._examAttempts[lessonId] = atts;
      // Update DB
      await sb.from('exam_attempts').update({
        score: score, total: total, answers: result, passed: passed
      }).eq('id', attemptId);
      var foundL = getLesson(lessonId);
      if (foundL && foundL.lesson.امتحان.totalQuestions > 0 && atts.length >= foundL.lesson.امتحان.maxAttempts) {
        if (!Progress[lessonId]) Progress[lessonId] = {};
        Progress[lessonId].completed = true;
        Progress[lessonId].progress = 100;
        Progress[lessonId].score = pct;
        Progress[lessonId].lastAttempt = Date.now();
        Progress[lessonId].lastResult = result;
        saveProgress();
      }
    } else {
      // Legacy exam
      if (!Progress[lessonId]) Progress[lessonId] = {};
      Progress[lessonId].completed = true;
      Progress[lessonId].progress = 100;
      Progress[lessonId].score = pct;
      Progress[lessonId].lastAttempt = Date.now();
      Progress[lessonId].lastResult = result;
      saveProgress();
    }
    renderReport(lessonId, type, quizState.questions, result);
  }
  } catch(e) { console.error('submitAll error:', e); alert('Error submitting: ' + e.message); }
}

function renderReport(lessonId, type, questions, result) {
  const { answers, score, total } = result;
  const pct = Math.round(score / total * 100);
  const label = document.getElementById('quiz-type-label');
  if (label) label.textContent = type === 'exam' || type === 'final' ? 'Exam' : type === 'review' ? 'Smart Review' : 'Homework';
  const bar = document.getElementById('quiz-bar');
  const txt = document.getElementById('quiz-progress-text');
  if (bar) bar.style.width = '100%';
  if (txt) txt.textContent = total + '/' + total;
  let report = '<div class="quiz-result" style="display:block"><div class="result-score">' + pct + '%</div><div class="result-label">Score</div><div class="result-msg">' + (type === 'hw' ? '' : (pct >= 80 ? 'Excellent!' : pct >= 60 ? 'Passed!' : 'Keep trying.')) + '</div>';
  // Per-lesson analysis for review type
  if (type === 'review' && questions && questions.length > 0) {
    try {
      var lessonStats = {};
      var lessonTitles = {};
      for (var ci = 0; ci < COURSES.length; ci++)
        for (var li = 0; li < COURSES[ci].lessons.length; li++)
          lessonTitles[COURSES[ci].lessons[li].id] = COURSES[ci].lessons[li].title;
      questions.forEach(function(q, i) {
        var lid = q.sourceLid || 'unknown';
        if (!lessonStats[lid]) lessonStats[lid] = { lid: lid, count: 0, wrong: 0 };
        lessonStats[lid].count++;
        if (answers[i] === undefined || answers[i] < 0 || answers[i] !== q.correct) lessonStats[lid].wrong++;
      });
      var sorted = Object.keys(lessonStats).map(function(k) { return lessonStats[k]; }).sort(function(a, b) { return (b.wrong / b.count) - (a.wrong / a.count); });
      report += '<div class="rv-section" style="margin-top:24px"><div class="rv-section-header"><div class="rv-section-title">Lesson Analysis</div><div class="rv-section-desc">Your performance by lesson</div></div>';
      sorted.forEach(function(s) {
        var title = lessonTitles[s.lid] || 'Lesson ' + s.lid;
        var rate = Math.round(s.wrong / s.count * 100);
        report += '<div class="rv-rank-row"><span class="rv-rank-title" style="flex:3">' + esc(title) + '</span><span class="rv-rank-bar-wrap" style="flex:1"><span class="rv-rank-bar"><span class="rv-rank-fill" style="width:' + rate + '%"></span></span></span><span class="rv-rank-pct">' + rate + '%</span><span class="rv-rank-count">' + s.wrong + '/' + s.count + ' wrong</span></div>';
      });
      report += '</div>';
    } catch(e) { console.error('Review analysis error:', e); }
  }
  const SU = 'https://usllnkoqqpfynsiprvqh.supabase.co/storage/v1/object/public/question-images/';
  questions.forEach((q, i) => {
    const userAns = answers[i];
    const isCorrect = userAns === q.correct;
    const status = isCorrect ? 'correct' : 'incorrect';
    if (q.isImage) {
      var imgUrl = SU + q.imgQ;
      report += '<div class="report-question ' + status + '" style="margin-top:20px;padding:16px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface)"><div class="q-number" style="margin-bottom:8px">Question ' + (i+1) + '</div><div style="text-align:center;margin:8px 0"><img src="' + imgUrl + '" style="max-width:100%;border-radius:var(--radius);border:1px solid var(--border)" onclick="window.open(this.src)"></div>';
      var letters = ['A', 'B', 'C', 'D'];
      letters.forEach(function(l, oi) {
        var cls = '';
        var lbl = '';
        if (oi === q.correct) { cls = 'correct'; lbl = ' (Correct)'; }
        else if (oi === userAns) { cls = 'incorrect'; lbl = ' (Your answer)'; }
        var optImg = q.option_images?.[oi] ? '<img src="' + SU + q.option_images[oi] + '" style="max-width:40px;max-height:40px;vertical-align:middle;margin-right:6px;border-radius:4px;border:1px solid var(--border)">' : '';
        report += '<div class="quiz-option ' + cls + '" style="cursor:default;margin-bottom:6px">' + optImg + l + lbl + '</div>';
      });
      if (q.explanation || q.explanation_image_url) {
        report += '<div style="margin-top:12px;padding:12px;background:var(--surface);border-radius:var(--radius);border:1px solid var(--border)"><div style="font-size:.75rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Explanation of choice</div>';
        if (q.explanation) report += '<div style="font-size:.8125rem;color:var(--ink);margin-bottom:6px">' + esc(q.explanation) + '</div>';
        if (q.explanation_image_url) report += '<div style="text-align:center"><img src="' + SU + esc(q.explanation_image_url) + '" style="max-width:100%;border-radius:var(--radius);border:1px solid var(--border);cursor:pointer" onclick="window.open(this.src)" loading="lazy"></div>';
        report += '</div>';
      }
      report += '</div>';
      return;
    }
    const imgHtml = q.image_url ? '<div style="text-align:center;margin:8px 0"><img src="' + SU + q.image_url + '" style="max-width:100%;max-height:200px;border-radius:var(--radius);border:1px solid var(--border)"></div>' : '';
    report += '<div class="report-question ' + status + '" style="margin-top:20px;padding:16px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface)"><div class="q-number" style="margin-bottom:8px">Question ' + (i+1) + '</div><h2 style="font-size:1rem;margin-bottom:12px">' + q.q + '</h2>' + imgHtml + (q.math ? '<div class="math-block">$$' + esc(q.math) + '$$</div>' : '');
    q.opts.forEach((o, oi) => {
      let cls = '';
      let lbl = '';
      const optImg = q.option_images?.[oi] ? '<img src="' + SU + q.option_images[oi] + '" style="max-width:40px;max-height:40px;vertical-align:middle;margin-right:6px;border-radius:4px;border:1px solid var(--border)">' : '';
      if (oi === q.correct) { cls = 'correct'; lbl = ' (Correct)'; }
      else if (oi === userAns) { cls = 'incorrect'; lbl = ' (Your answer)'; }
      report += '<div class="quiz-option ' + cls + '" style="cursor:default;margin-bottom:6px">' + optImg + o + lbl + '</div>';
    });
    if (q.explanation || q.explanation_image_url) {
      report += '<div style="margin-top:12px;padding:12px;background:var(--surface);border-radius:var(--radius);border:1px solid var(--border)"><div style="font-size:.75rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Explanation of choice</div>';
      if (q.explanation) report += '<div style="font-size:.8125rem;color:var(--ink);margin-bottom:6px">' + esc(q.explanation) + '</div>';
      if (q.explanation_image_url) report += '<div style="text-align:center"><img src="' + SU + esc(q.explanation_image_url) + '" style="max-width:100%;border-radius:var(--radius);border:1px solid var(--border);cursor:pointer" onclick="window.open(this.src)" loading="lazy"></div>';
      report += '</div>';
    }
    report += '</div>';
  });
  report += '<div style="display:flex;gap:12px;justify-content:center;margin-top:24px">';
  if (type === 'review') {
    report += '<button class="btn btn-primary" onclick="showView(\'review\')">View Analysis</button>';
  } else {
    report += '<button class="btn btn-primary" onclick="renderCourses();showView(\'courses\')">Back to Courses</button>';
  }
  report += '</div>';
  document.getElementById('quiz-content').innerHTML = report;
  if (typeof renderMathInElement === 'function') renderMathInElement(document.getElementById('quiz-content'), { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '\\(', right: '\\)', display: false }] });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function viewHW(lid) {
  const found = getLesson(lid);
  if (!found) return;
  const result = Progress[lid]?.hwResult;
  if (!result) return;
  var allQs = (found.lesson.واجب.questions || []).slice();
  if (found.lesson.واجب.imageQuestions) {
    found.lesson.واجب.imageQuestions.forEach(function(iq) {
      var letterIndex = iq.correct === 'A' ? 0 : iq.correct === 'B' ? 1 : iq.correct === 'C' ? 2 : iq.correct === 'D' ? 3 : 0;
      allQs.push({ q: '', opts: ['A', 'B', 'C', 'D'], correct: letterIndex, math: '', image_url: '', option_images: iq.option_images || [], isImage: true, imgQ: iq.imgQ, explanation: iq.explanation, explanation_image_url: iq.explanation_image_url || '' });
    });
  }
  showView('quiz');
  renderReport(lid, 'hw', allQs, result);
}

function viewExam(lid) {
  const found = getLesson(lid);
  if (!found) return;
  const result = Progress[lid]?.lastResult;
  if (!result) return;
  var allQs = (found.lesson.امتحان.questions || []).slice();
  if (found.lesson.امتحان.imageQuestions) {
    found.lesson.امتحان.imageQuestions.forEach(function(iq) {
      var letterIndex = iq.correct === 'A' ? 0 : iq.correct === 'B' ? 1 : iq.correct === 'C' ? 2 : iq.correct === 'D' ? 3 : 0;
      allQs.push({ q: '', opts: ['A', 'B', 'C', 'D'], correct: letterIndex, math: '', image_url: '', option_images: iq.option_images || [], isImage: true, imgQ: iq.imgQ, explanation: iq.explanation, explanation_image_url: iq.explanation_image_url || '' });
    });
  }
  showView('quiz');
  renderReport(lid, 'exam', allQs, result);
}

function goToNextLesson(lid) {
  showView('courses');
  setTimeout(() => {
    const el = document.querySelector('[data-lid="' + lid + '"]');
    if (!el) return;
    const card = el.closest('.course-card');
    if (card && !card.classList.contains('open')) toggleCourse(card);
    setTimeout(() => {
      document.getElementById('ls-' + lid)?.classList.add('open');
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
  }, 60);
}
function esc(s) { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/`/g,'&#96;'); }

function getNextLessonId(lid) {
  for (let ci = 0; ci < COURSES.length; ci++) {
    const c = COURSES[ci];
    for (let li = 0; li < c.lessons.length; li++) {
      if (c.lessons[li].id === lid) {
        if (li + 1 < c.lessons.length) return c.lessons[li + 1].id;
        if (ci + 1 < COURSES.length) return COURSES[ci + 1].lessons[0].id;
      }
    }
  }
  return null;
}

// ========== DYNAMIC EXAM SYSTEM ==========

async function initQuestionPool(lid) {
  var found = getLesson(lid);
  if (!found) return;
  var totalQ = found.lesson.امتحان.totalQuestions;
  if (!totalQ) return;
  var { data: existing } = await sb.from('exam_student_pool').select('id').eq('user_id', currentUser.id).eq('lesson_id', lid).limit(1);
  if (existing && existing.length > 0) return;
  var { data: ex } = await sb.from('exams').select('id').eq('lesson_id', lid).single();
  if (!ex) return;
  var examId = ex.id;
  var [stdR, imgR] = await Promise.all([
    sb.from('exam_questions').select('id').eq('exam_id', examId).order('sort_order'),
    sb.from('exam_image_questions').select('id').eq('exam_id', examId).order('sort_order')
  ]);
  var allIds = [];
  (stdR.data || []).forEach(function(r) { allIds.push({ type: 'standard', id: r.id }); });
  (imgR.data || []).forEach(function(r) { allIds.push({ type: 'image', id: r.id }); });
  for (var i = allIds.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = allIds[i]; allIds[i] = allIds[j]; allIds[j] = tmp;
  }
  var selected = allIds.slice(0, Math.min(totalQ, allIds.length));
  // Build a lookup from local questions to DB IDs
  // Store __originalId on the local question objects
  var stdArr = (stdR.data || []);
  var imgArr = (imgR.data || []);
  // Map the original DB IDs back to local index for the pool selection
  // We insert into pool using the actual DB question IDs
  for (var r = 0; r < selected.length; r++) {
    await sb.from('exam_student_pool').insert({
      user_id: currentUser.id, lesson_id: lid,
      question_type: selected[r].type, question_id: selected[r].id,
      seen: false
    });
  }
}

async function getPoolUnseenCount(lid) {
  var { count } = await sb.from('exam_student_pool')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', currentUser.id)
    .eq('lesson_id', lid)
    .eq('seen', false);
  return count || 0;
}

async function selectAttemptQuestions(lid) {
  var found = getLesson(lid);
  var qpa = (found && found.lesson.امتحان.questionsPerAttempt) || 0;
  if (qpa <= 0) {
    qpa = Math.floor(found.lesson.امتحان.totalQuestions / Math.max(1, found.lesson.امتحان.maxAttempts));
    if (qpa <= 0) qpa = 10;
  }
  var { data: unseen } = await sb.from('exam_student_pool')
    .select('question_type, question_id')
    .eq('user_id', currentUser.id)
    .eq('lesson_id', lid)
    .eq('seen', false)
    .limit(qpa);
  if (!unseen || unseen.length === 0) return null;
  for (var i = unseen.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = unseen[i]; unseen[i] = unseen[j]; unseen[j] = tmp;
  }
  var chosen = unseen.slice(0, Math.min(qpa, unseen.length));
  return chosen;
}

async function loadBatchQuestions(ids) {
  var stdIds = []; var imgIds = []; var hwStdIds = []; var hwImgIds = [];
  ids.forEach(function(item) {
    if (item.question_type === 'standard') stdIds.push(item.question_id);
    else if (item.question_type === 'image') imgIds.push(item.question_id);
    else if (item.question_type === 'hw_standard') hwStdIds.push(item.question_id);
    else if (item.question_type === 'hw_image') hwImgIds.push(item.question_id);
  });
  var result = {};
  if (stdIds.length > 0) {
    var { data: stdData } = await sb.from('exam_questions').select('*').in('id', stdIds);
    if (stdData) stdData.forEach(function(q) { result['std_' + q.id] = q; });
  }
  if (imgIds.length > 0) {
    var { data: imgData } = await sb.from('exam_image_questions').select('*').in('id', imgIds);
    if (imgData) imgData.forEach(function(q) { result['img_' + q.id] = q; });
  }
  if (hwStdIds.length > 0) {
    var { data: hwStdData } = await sb.from('hw_questions').select('*').in('id', hwStdIds);
    if (hwStdData) hwStdData.forEach(function(q) { result['hw_std_' + q.id] = q; });
  }
  if (hwImgIds.length > 0) {
    var { data: hwImgData } = await sb.from('hw_image_questions').select('*').in('id', hwImgIds);
    if (hwImgData) hwImgData.forEach(function(q) { result['hw_img_' + q.id] = q; });
  }
  var qs = [];
  ids.forEach(function(item) {
    if (item.question_type === 'standard') {
      var sq = result['std_' + item.question_id];
      if (sq) qs.push({ q: sq.question, opts: sq.options, correct: sq.correct, math: sq.math || '', image_url: sq.image_url || '', option_images: sq.option_images || [], isImage: false, explanation: sq.explanation || '', explanation_image_url: sq.explanation_image_url || '' });
    } else if (item.question_type === 'image') {
      var iq = result['img_' + item.question_id];
      if (iq) {
        var li = iq.correct === 'A' ? 0 : iq.correct === 'B' ? 1 : iq.correct === 'C' ? 2 : iq.correct === 'D' ? 3 : 0;
        qs.push({ q: '', opts: ['A', 'B', 'C', 'D'], correct: li, math: '', image_url: '', option_images: iq.option_images || [], isImage: true, imgQ: iq.image_url, explanation: iq.explanation || '', explanation_image_url: iq.explanation_image_url || '' });
      }
    } else if (item.question_type === 'hw_standard') {
      var hq = result['hw_std_' + item.question_id];
      if (hq) qs.push({ q: hq.question, opts: hq.options, correct: hq.correct, math: hq.math || '', image_url: hq.image_url || '', option_images: hq.option_images || [], isImage: false, explanation: hq.explanation || '', explanation_image_url: hq.explanation_image_url || '' });
    } else if (item.question_type === 'hw_image') {
      var hiq = result['hw_img_' + item.question_id];
      if (hiq) {
        var li2 = hiq.correct === 'A' ? 0 : hiq.correct === 'B' ? 1 : hiq.correct === 'C' ? 2 : hiq.correct === 'D' ? 3 : 0;
        qs.push({ q: '', opts: ['A', 'B', 'C', 'D'], correct: li2, math: '', image_url: '', option_images: hiq.option_images || [], isImage: true, imgQ: hiq.image_url, explanation: hiq.explanation || '', explanation_image_url: hiq.explanation_image_url || '' });
      }
    }
  });
  return qs;
}

var _dynamicExamRunning = false;
async function startDynamicExam(lid) {
  if (!currentUser) { alert('Please log in.'); return; }
  if (_dynamicExamRunning) return;
  if (quizState && !quizState.submitted) { alert('You already have an exam in progress. Please finish it first.'); return; }
  _dynamicExamRunning = true;
  try {
  var found = getLesson(lid);
  if (!found) return;
  currentLessonId = lid;
  await initQuestionPool(lid);
  var remaining = await getPoolUnseenCount(lid);
  if (remaining === 0) {
    var { count: poolCount } = await sb.from('exam_student_pool')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', currentUser.id)
      .eq('lesson_id', lid);
    var totalQ = found.lesson.امتحان.totalQuestions;
    if (poolCount !== totalQ) {
      await sb.from('exam_student_pool').delete()
        .eq('user_id', currentUser.id).eq('lesson_id', lid);
      await initQuestionPool(lid);
    } else {
      await sb.from('exam_student_pool')
        .update({ seen: false, attempt_id: null })
        .eq('user_id', currentUser.id)
        .eq('lesson_id', lid);
    }
    remaining = await getPoolUnseenCount(lid);
    if (remaining === 0) {
      alert('No questions available. Please add questions to the exam pool first.');
      return;
    }
  }
  var selected = await selectAttemptQuestions(lid);
  if (!selected || selected.length === 0) return;
  var qs = await loadBatchQuestions(selected);
  if (qs.length === 0) { alert('No questions.'); return; }
  var attempts = (window._examAttempts[lid] || []);
  var attNum = attempts.length + 1;
  var qOrder = selected.map(function(s) { return { question_type: s.question_type, question_id: s.question_id }; });
  var { data: att } = await sb.from('exam_attempts').insert({
    user_id: currentUser.id, lesson_id: lid,
    attempt_number: attNum, score: 0, total: qs.length,
    answers: null, passed: false,
    question_order: qOrder
  }).select('id').single();
  if (!att) { alert('Failed to create attempt.'); return; }
  var attemptId = att.id;
  for (var m = 0; m < selected.length; m++) {
    await sb.from('exam_student_pool').update({ seen: true, attempt_id: attemptId })
      .eq('user_id', currentUser.id)
      .eq('lesson_id', lid)
      .eq('question_type', selected[m].question_type)
      .eq('question_id', selected[m].question_id);
  }
  if (!window._examAttempts[lid]) window._examAttempts[lid] = [];
  window._examAttempts[lid].push({ id: attemptId, attempt_number: attNum, score: 0, total: qs.length, passed: false, answers: null });
  quizState = { lessonId: lid, type: 'exam', questions: qs, total: qs.length, answers: new Array(qs.length).fill(-1), submitted: false, attemptId: attemptId };
  var label = document.getElementById('quiz-type-label');
  if (label) label.textContent = 'Attempt ' + attNum;
  var bar = document.getElementById('quiz-bar');
  var txt = document.getElementById('quiz-progress-text');
  if (bar) bar.style.width = '0%';
  if (txt) txt.textContent = '0/' + qs.length;
  startTimer(found.lesson.امتحان.timeLimit || 20);
  showView('quiz');
  renderAllQuestions();
  } catch(e) { console.error('startDynamicExam error:', e); alert('Error starting exam: ' + e.message); }
  finally { _dynamicExamRunning = false; }
}

async function viewExamAttempt(lid, attemptId) {
  var { data: att } = await sb.from('exam_attempts').select('*').eq('id', attemptId).single();
  if (!att || !att.answers) { alert('Attempt data not found.'); return; }
  var poolItems = att.question_order;
  if (!poolItems) {
    var { data: pi } = await sb.from('exam_student_pool')
      .select('question_type, question_id')
      .eq('attempt_id', attemptId)
      .eq('user_id', currentUser.id);
    poolItems = pi;
  }
  if (!poolItems) return;
  var qs = await loadBatchQuestions(poolItems);
  if (qs.length === 0) return;
  showView('quiz');
  renderReport(lid, 'exam', qs, att.answers);
}

async function startFinalExam(lid) {
  if (!currentUser) { alert('Please log in.'); return; }
  var found = getLesson(lid);
  if (!found) return;
  currentLessonId = lid;
  var { data: seen } = await sb.from('exam_student_pool')
    .select('question_type, question_id')
    .eq('user_id', currentUser.id)
    .eq('lesson_id', lid)
    .eq('seen', true);
  if (!seen || seen.length === 0) { alert('No questions available.'); return; }
  // Shuffle and take all
  for (var i = seen.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = seen[i]; seen[i] = seen[j]; seen[j] = tmp;
  }
  var qs = await loadBatchQuestions(seen);
  if (qs.length === 0) { alert('No questions.'); return; }
  quizState = { lessonId: lid, type: 'final', questions: qs, total: qs.length, answers: new Array(qs.length).fill(-1), submitted: false };
  var label = document.getElementById('quiz-type-label');
  if (label) label.textContent = 'Final Exam';
  var bar = document.getElementById('quiz-bar');
  var txt = document.getElementById('quiz-progress-text');
  if (bar) bar.style.width = '0%';
  if (txt) txt.textContent = '0/' + qs.length;
  startTimer(found.lesson.امتحان.timeLimit || 20);
  showView('quiz');
  renderAllQuestions();
}

// ============ COMMUNITY SYSTEM ============
var _cmFilter = 'latest';
var _cmPosts = [];
var _cmUserLikes = {};

function timeAgo(d) {
  if (!d) return '';
  var sec = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (sec < 60) return 'just now';
  var min = Math.floor(sec / 60);
  if (min < 60) return min + 'm ago';
  var hr = Math.floor(min / 60);
  if (hr < 24) return hr + 'h ago';
  var day = Math.floor(hr / 24);
  if (day < 30) return day + 'd ago';
  return new Date(d).toLocaleDateString();
}

function showModal(html) { document.getElementById('app-modal-body').innerHTML = html; document.getElementById('app-modal').classList.add('show'); }
function hideModal() { document.getElementById('app-modal').classList.remove('show'); }
document.addEventListener('click', function(e) { if (e.target === document.getElementById('app-modal')) hideModal(); });

function getLessonName(lid) {
  for (var ci = 0; ci < COURSES.length; ci++) {
    for (var li = 0; li < COURSES[ci].lessons.length; li++) {
      if (COURSES[ci].lessons[li].id === lid) return COURSES[ci].lessons[li].title;
    }
  }
  return 'Lesson';
}

async function showCommunity() {
  var list = document.getElementById('cm-list');
  if (!list) return;
  list.innerHTML = '<div class="cm-shimmer"></div><div class="cm-shimmer"></div><div class="cm-shimmer"></div>';
  // Populate lesson filter (native select stays hidden, custom dropdown gets populated)
  var sel = document.getElementById('cm-lesson-filter');
  if (sel && sel.options.length <= 1) {
    var userLevel = userProfile?.level || 'sec1';
    for (var ci = 0; ci < COURSES.length; ci++) {
      if (COURSES[ci].level !== userLevel) continue;
      for (var li = 0; li < COURSES[ci].lessons.length; li++) {
        var l = COURSES[ci].lessons[li];
        var opt = document.createElement('option');
        opt.value = l.id; opt.textContent = COURSES[ci].title + ' — ' + l.title;
        sel.appendChild(opt);
      }
    }
  }
  // Sync custom dropdown from hidden select
  var menu = document.getElementById('cm-dropdown-menu');
  if (menu && sel) {
    menu.innerHTML = '<div class="cm-dropdown-item active" data-value="" onclick="selectLessonDropdown(\'\')">All Lessons</div>';
    for (var i = 1; i < sel.options.length; i++) {
      var o = sel.options[i];
      var di = document.createElement('div');
      di.className = 'cm-dropdown-item';
      di.textContent = o.textContent;
      di.dataset.value = o.value;
      di.onclick = function(v) { return function() { selectLessonDropdown(v); }; }(o.value);
      menu.appendChild(di);
    }
  }
  await loadCommunityPosts();
}

function toggleLessonDropdown() {
  var dd = document.getElementById('cm-dropdown');
  if (!dd) return;
  dd.classList.toggle('open');
}

function selectLessonDropdown(value) {
  var dd = document.getElementById('cm-dropdown');
  var sel = document.getElementById('cm-lesson-filter');
  var label = document.getElementById('cm-dropdown-label');
  if (sel) sel.value = value;
  if (label) {
    if (!value) label.textContent = 'All Lessons';
    else {
      var opt = sel ? sel.options[sel.selectedIndex] : null;
      label.textContent = opt ? opt.textContent : 'All Lessons';
    }
  }
  // Update active class on items
  var items = document.querySelectorAll('.cm-dropdown-item');
  items.forEach(function(item) { item.classList.toggle('active', item.dataset.value === value); });
  if (dd) dd.classList.remove('open');
  applyCommunityFilters();
}

function toggleProfileLevelDropdown() {
  var dd = document.getElementById('profile-level-dropdown');
  if (dd) dd.classList.toggle('open');
}

function selectProfileLevel(value) {
  var dd = document.getElementById('profile-level-dropdown');
  var label = document.getElementById('profile-level-label');
  var labels = { sec1: 'Secondary 1', sec2: 'Secondary 2', sec3: 'Secondary 3' };
  if (label) label.textContent = labels[value] || value;
  var items = document.querySelectorAll('#profile-level-menu .cm-dropdown-item');
  items.forEach(function(item) { item.classList.toggle('active', item.dataset.value === value); });
  if (dd) dd.classList.remove('open');
  updateProfileLevel(value);
}

// Close dropdowns on outside click
document.addEventListener('click', function(e) {
  var dd = document.getElementById('cm-dropdown');
  if (dd && !dd.contains(e.target)) dd.classList.remove('open');
  var pd = document.getElementById('profile-level-dropdown');
  if (pd && !pd.contains(e.target)) pd.classList.remove('open');
});

async function loadCommunityPosts() {
  try {
    if (!currentUser) { document.getElementById('cm-list').innerHTML = '<div class="cm-empty"><div class="cm-empty-icon">🔒</div><h3>Sign in to access the community</h3><p>Log in to ask questions and see posts from your level.</p></div>'; return; }
    var { data: posts } = await sb.from('community_posts').select('*, profiles!community_posts_user_id_fkey(name,profile_pic), likes:community_likes(count), comments:community_comments(count)').order('created_at', { ascending: false });
    if (!posts || posts.length === 0) { document.getElementById('cm-list').innerHTML = '<div class="cm-empty"><div class="cm-empty-icon">📭</div><h3>No posts yet</h3><p>Be the first to ask a question!</p></div>'; return; }
    _cmPosts = posts;
    var { data: myLikes } = await sb.from('community_likes').select('post_id').eq('user_id', currentUser.id);
    _cmUserLikes = {};
    if (myLikes) myLikes.forEach(function(l) { _cmUserLikes[l.post_id] = true; });
    applyCommunityFilters();
  } catch(e) { console.error('Load posts error:', e); alert('Error loading posts: ' + e.message); }
}

function setCommunityFilter(filter, btn) {
  _cmFilter = filter;
  document.querySelectorAll('.cm-filter').forEach(function(b) { b.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  applyCommunityFilters();
}

function applyCommunityFilters() {
  var filtered = _cmPosts.slice();
  var lessonVal = (document.getElementById('cm-lesson-filter')?.value || '');
  if (lessonVal) filtered = filtered.filter(function(p) { return String(p.lesson_id) === lessonVal; });
  if (_cmFilter === 'most_liked') filtered.sort(function(a,b) { return (b.likes?.[0]?.count||0) - (a.likes?.[0]?.count||0); });
  else if (_cmFilter === 'solved') filtered = filtered.filter(function(p) { return p.is_solved; });
  else if (_cmFilter === 'unsolved') filtered = filtered.filter(function(p) { return !p.is_solved; });
  else filtered.sort(function(a,b) { return new Date(b.created_at).getTime() - new Date(a.created_at).getTime(); });
  renderCommunityPosts(filtered);
}

function renderCommunityPosts(posts) {
  var list = document.getElementById('cm-list');
  if (!list) return;
  if (!posts || posts.length === 0) {
    list.innerHTML = '<div class="cm-empty"><div class="cm-empty-icon">📭</div><h3>No posts found</h3><p>Try changing the filters or create a new post.</p></div>';
    return;
  }
  var html = '';
  posts.forEach(function(p) {
    var likeCount = p.likes?.[0]?.count || 0;
    var commentCount = p.comments?.[0]?.count || 0;
    var liked = _cmUserLikes[p.id] ? ' liked' : '';
    var avatarHtml = '<div class="cm-card-avatar">' + (p.profiles?.profile_pic ? '<img src="' + esc(p.profiles.profile_pic) + '" alt="">' : (p.profiles?.name || 'U')[0].toUpperCase()) + '</div>';
    var pinned = p.is_pinned ? '<span class="cm-badge cm-badge-pinned">📌 Pinned</span>' : '';
    var solved = p.is_solved ? '<span class="cm-badge cm-badge-solved">✓ Solved</span>' : '';
    var lessonName = getLessonName(p.lesson_id);
    html += '<div class="cm-card' + (p.is_pinned ? ' cm-card-pinned' : '') + '" onclick="showPostDetail(' + p.id + ')">';
    html += '<div class="cm-card-top"><div class="cm-card-title"><a href="#" onclick="event.stopPropagation();showPostDetail(' + p.id + ')">' + esc(p.title) + '</a></div><div style="display:flex;gap:4px;flex-shrink:0">' + pinned + solved + '</div></div>';
    html += '<div class="cm-card-body">' + esc(p.description.substring(0, 200)) + '</div>';
    if (p.image_url) html += '<div class="cm-card-img"><img src="' + SUPABASE_URL + '/storage/v1/object/public/question-images/' + esc(p.image_url) + '" loading="lazy" onclick="event.stopPropagation();showPostDetail(' + p.id + ')"></div>';
    html += '<div class="cm-card-meta"><div class="cm-card-author">' + avatarHtml + '<span>' + esc(p.profiles?.name || 'User') + '</span></div><span class="cm-dot">·</span><span>' + esc(lessonName) + '</span><span class="cm-dot">·</span><span>' + timeAgo(p.created_at) + '</span>';
    html += '<div class="cm-card-stats"><span class="cm-card-stat' + liked + '"><span class="cm-stat-icon">' + (liked ? '♥' : '♡') + '</span><span class="cm-stat-num">' + likeCount + '</span></span><span class="cm-card-stat"><span class="cm-stat-icon">💬</span><span class="cm-stat-num">' + commentCount + '</span></span></div></div>';
    html += '</div>';
  });
  list.innerHTML = html;
}

var _cmPostImage = null;

async function cmUploadImage(file) {
  var compressed = await compressImage(file, 1200, 0.8);
  var path = 'community_' + Date.now() + '_' + Math.random().toString(36).slice(2,6) + '.jpg';
  var { data: { session } } = await sb.auth.getSession();
  var token = session?.access_token || '';
  var xhr = new XMLHttpRequest();
  xhr.open('POST', SUPABASE_URL + '/storage/v1/object/question-images/' + path);
  xhr.setRequestHeader('authorization', 'Bearer ' + token);
  xhr.setRequestHeader('x-upsert', 'true');
  await new Promise(function(resolve) {
    xhr.onload = function() { resolve(); };
    xhr.onerror = function() { resolve(); };
    xhr.send(compressed);
  });
  return xhr.status >= 200 && xhr.status < 300 ? path : null;
}

function handlePasteImage(event, previewId, callback) {
  var items = event.clipboardData?.items;
  if (!items) return;
  for (var i = 0; i < items.length; i++) {
    if (items[i].type.startsWith('image/')) {
      event.preventDefault();
      var file = items[i].getAsFile();
      if (!file) continue;
      cmUploadImage(file).then(function(path) {
        if (path) {
          var preview = document.getElementById(previewId);
          if (preview) {
            preview.innerHTML = '<div class="cm-pasted-img"><img src="' + SUPABASE_URL + '/storage/v1/object/public/question-images/' + path + '" style="max-width:100%;max-height:120px;border-radius:6px;border:1px solid var(--border)"><button class="cm-pasted-remove" onclick="this.parentElement.remove()">&times;</button></div>';
          }
          if (typeof callback === 'function') callback(path);
        }
      });
      break;
    }
  }
}

async function showCreatePost() {
  if (!currentUser) { alert('Please log in first.'); return; }
  _cmPostImage = null;
  var h = '<h2 style="margin-bottom:16px">New Post</h2>';
  h += '<label style="font-size:.8125rem;font-weight:600;color:var(--muted);display:block;margin-bottom:4px">Lesson</label><select id="f-post-lesson" class="auth-input">';
  var userLevel = userProfile?.level || 'sec1';
  for (var ci = 0; ci < COURSES.length; ci++) {
    if (COURSES[ci].level !== userLevel) continue;
    for (var li = 0; li < COURSES[ci].lessons.length; li++) {
      var l = COURSES[ci].lessons[li];
      h += '<option value="' + l.id + '">' + esc(COURSES[ci].title) + ' — ' + esc(l.title) + '</option>';
    }
  }
  h += '</select>';
  h += '<label style="font-size:.8125rem;font-weight:600;color:var(--muted);display:block;margin-bottom:4px">Title</label><input id="f-post-title" class="auth-input" placeholder="What\'s your question?" maxlength="200">';
  h += '<label style="font-size:.8125rem;font-weight:600;color:var(--muted);display:block;margin-bottom:4px">Description</label><textarea id="f-post-desc" class="auth-input" rows="4" placeholder="Explain your question in detail... Paste an image (Ctrl+V) to add a screenshot" maxlength="10000" onpaste="handlePasteImage(event,\'cm-post-preview\',function(p){_cmPostImage=p})"></textarea>';
  h += '<div id="cm-post-preview" style="margin-bottom:8px"></div>';
  h += '<div style="font-size:.75rem;color:var(--muted);margin-bottom:8px">&#128247; Paste an image (Ctrl+V) into the description to attach it</div>';
  h += '<div class="admin-modal-footer"><button class="btn btn-primary" onclick="submitPost()">Post</button><button class="btn btn-ghost" onclick="hideModal()">Cancel</button></div>';
  showModal(h);
}

async function submitPost() {
  try {
  var lessonId = document.getElementById('f-post-lesson')?.value;
  var title = document.getElementById('f-post-title')?.value.trim();
  var desc = document.getElementById('f-post-desc')?.value.trim();
  if (!title || title.length < 3) { alert('Title must be at least 3 characters.'); return; }
  if (!desc) { alert('Please add a description.'); return; }
  await ensureBannedCache();
  var violations = checkBannedContent(title + ' ' + desc);
  if (violations.length > 0) {
    var sev = violations[0].severity;
    var msg = 'Your post contains inappropriate language and cannot be published.';
    if (sev === 'moderate') msg = 'Please remove offensive language before posting.';
    else if (sev === 'severe') msg = 'Severe language detected. Your post has been blocked.';
    alert(msg); return;
  }
  var { error } = await sb.from('community_posts').insert({ user_id: currentUser.id, lesson_id: lessonId, title: title, description: desc, image_url: _cmPostImage });
  if (error) { alert('Error: ' + error.message); return; }
  _cmPostImage = null;
  hideModal();
  await loadCommunityPosts();
  } catch(e) { console.error('submitPost error:', e); alert('Error creating post: ' + e.message); }
}

async function showPostDetail(postId) {
  var { data: post } = await sb.from('community_posts').select('*, profiles!community_posts_user_id_fkey(name,profile_pic)').eq('id', postId).single();
  if (!post) { alert('Post not found.'); return; }
  var { count: likeCount } = await sb.from('community_likes').select('id', { count: 'exact', head: true }).eq('post_id', postId);
  var liked = _cmUserLikes[postId] ? ' liked' : '';
  var isOwner = currentUser && currentUser.id === post.user_id;
  var isTeacher = currentUser && (userProfile?.role === 'teacher');
  var avatarL = (post.profiles?.name || 'U')[0].toUpperCase();
  var avatarImg = post.profiles?.profile_pic ? '<img src="' + esc(post.profiles.profile_pic) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">' : avatarL;
  var pinned = post.is_pinned ? '<span class="cm-badge cm-badge-pinned">📌 Pinned</span>' : '';
  var solved = post.is_solved ? '<span class="cm-badge cm-badge-solved">✓ Solved</span>' : '';

  var h = '<div class="cm-post-modal">';
  h += '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:8px"><h2 style="font-size:1.25rem;font-weight:700;letter-spacing:-.02em;flex:1">' + esc(post.title) + '</h2><div style="display:flex;gap:4px;flex-shrink:0">' + pinned + solved + '</div></div>';
  h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;font-size:.8125rem;color:var(--muted)"><div class="cm-card-avatar" style="width:28px;height:28px;font-size:.6875rem">' + avatarImg + '</div><span style="font-weight:600;color:var(--ink)">' + esc(post.profiles?.name || 'User') + '</span><span>·</span><span>' + esc(getLessonName(post.lesson_id)) + '</span><span>·</span><span>' + timeAgo(post.created_at) + '</span></div>';
  if (post.image_url) h += '<img class="cm-post-img" src="' + SUPABASE_URL + '/storage/v1/object/public/question-images/' + esc(post.image_url) + '" onclick="window.open(this.src)">';
  h += '<div class="cm-post-body">' + esc(post.description) + '</div>';

  h += '<div class="cm-post-actions">';
  h += '<button class="cm-action-btn' + liked + '" onclick="toggleLike(' + postId + ',this)">' + (liked ? '♥' : '♡') + ' <span id="cm-like-count-' + postId + '">' + (likeCount||0) + '</span></button>';
  if (isOwner && !post.is_solved) h += '<button class="cm-action-btn" onclick="toggleSolved(' + postId + ')">✓ Mark as Solved</button>';
  if (isOwner && post.is_solved) h += '<button class="cm-action-btn solved" onclick="toggleSolved(' + postId + ')">✓ Solved</button>';
  if (isTeacher && !post.is_pinned) h += '<button class="cm-action-btn" onclick="togglePin(' + postId + ')">📌 Pin</button>';
  if (isTeacher && post.is_pinned) h += '<button class="cm-action-btn" onclick="togglePin(' + postId + ')">📌 Unpin</button>';
  h += '<button class="cm-action-btn danger" onclick="reportPostModal(' + postId + ')">🚩 Report</button>';
  h += '</div>';

  h += '<div class="cm-comment-section"><h3 style="font-size:.9375rem;font-weight:700;margin-bottom:12px">Comments</h3>';
  h += '<div class="cm-comment-form"><textarea id="f-new-comment-' + postId + '" placeholder="Write a comment... Paste an image (Ctrl+V) to attach" rows="2" onpaste="handlePasteImage(event,\'cm-comment-preview-' + postId + '\',function(p){document.getElementById(\'f-comment-img-' + postId + '\').value=p})"></textarea><input type="hidden" id="f-comment-img-' + postId + '" value=""><div style="flex-shrink:0;display:flex;flex-direction:column;gap:4px"><button class="btn btn-primary btn-sm" onclick="addComment(' + postId + ',null)">Post</button></div></div><div id="cm-comment-preview-' + postId + '" style="margin-bottom:8px"></div>';
  h += '<div id="cm-comments-' + postId + '"><div style="text-align:center;padding:24px;color:var(--muted);font-size:.875rem">Loading comments...</div></div></div>';
  h += '<div id="cm-related-' + postId + '"><div style="text-align:center;padding:16px;color:var(--muted);font-size:.8125rem">Loading related questions...</div></div>';
  h += '</div>';
  showModal(h);
  loadComments(postId);
  loadRelatedPosts(post.lesson_id, postId);
}

async function loadRelatedPosts(lessonId, excludePostId) {
  var container = document.getElementById('cm-related-' + excludePostId);
  if (!container) return;
  var { data: posts } = await sb.from('community_posts').select('id,title,likes:community_likes(count),comments:community_comments(count)').eq('lesson_id', lessonId).neq('id', excludePostId).order('created_at', { ascending: false });
  if (!posts || posts.length === 0) { container.innerHTML = ''; return; }
  posts.sort(function(a,b) { return ((b.likes?.[0]?.count||0)*2 + (b.comments?.[0]?.count||0)) - ((a.likes?.[0]?.count||0)*2 + (a.comments?.[0]?.count||0)); });
  var top = posts.slice(0, 4);
  var h = '<div class="cm-related"><div class="cm-related-head">Related Questions</div>';
  top.forEach(function(p) {
    h += '<div class="cm-related-item" onclick="hideModal();showPostDetail(' + p.id + ')"><div class="cm-related-title">' + esc(p.title) + '</div><div class="cm-related-meta">♥ ' + (p.likes?.[0]?.count||0) + ' · 💬 ' + (p.comments?.[0]?.count||0) + '</div></div>';
  });
  h += '</div>';
  container.innerHTML = h;
}

async function loadComments(postId) {
  var { data: comments } = await sb.from('community_comments').select('*, profiles!community_comments_user_id_fkey(name,profile_pic)').eq('post_id', postId).order('created_at', { ascending: true });
  var container = document.getElementById('cm-comments-' + postId);
  if (!container) return;
  if (!comments || comments.length === 0) { container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--muted);font-size:.875rem">No comments yet. Be the first!</div>'; return; }
  container.innerHTML = renderCommentTree(comments, null, postId);
}

function renderCommentTree(comments, parentId, postId) {
  var children = comments.filter(function(c) { return c.parent_id === parentId; });
  if (children.length === 0) return '';
  var html = '';
  children.forEach(function(c) {
    var isTeacher = currentUser && (userProfile?.role === 'teacher');
    var isOwner = currentUser && currentUser.id === c.user_id;
    var avatarL = (c.profiles?.name || 'U')[0].toUpperCase();
    var avatarImg = c.profiles?.profile_pic ? '<img src="' + esc(c.profiles.profile_pic) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">' : avatarL;
    var verified = c.is_verified_answer ? '<span class="cm-verified-badge">✓ Verified Answer</span>' : '';
    var commentImg = c.image_url ? '<img src="' + SUPABASE_URL + '/storage/v1/object/public/question-images/' + esc(c.image_url) + '" style="max-width:100%;max-height:200px;border-radius:6px;border:1px solid var(--border);margin-top:6px" onclick="window.open(this.src)">' : '';
    html += '<div class="cm-comment">';
    html += '<div class="cm-comment-avatar">' + avatarImg + '</div>';
    html += '<div class="cm-comment-body"><div class="cm-comment-header"><span class="cm-comment-author">' + esc(c.profiles?.name || 'User') + '</span>' + verified + '<span class="cm-comment-time">' + timeAgo(c.created_at) + '</span></div>';
    html += '<div class="cm-comment-text">' + esc(c.content) + commentImg + '</div>';
    html += '<div class="cm-comment-actions">';
    html += '<button onclick="showReplyForm(' + c.id + ',' + postId + ')">Reply</button>';
    if (isTeacher && !c.is_verified_answer) html += '<button onclick="markVerifiedAnswer(' + c.id + ',' + postId + ')" style="color:var(--success)">✓ Verify</button>';
    if (isOwner || isTeacher) html += '<button onclick="deleteComment(' + c.id + ',' + postId + ')" style="color:var(--error)">Delete</button>';
    html += '</div>';
    var depth = 0;
    var pc = c;
    while (pc.parent_id) { depth++; var found = comments.find(function(x) { return x.id === pc.parent_id; }); if (!found) break; pc = found; }
    if (depth < 2) {
      var replies = renderCommentTree(comments, c.id, postId);
      if (replies) html += '<div class="cm-replies">' + replies + '</div>';
    }
    html += '<div id="cm-reply-form-' + c.id + '" style="display:none" class="cm-comment-form" style="margin-top:8px;margin-bottom:8px"><textarea id="f-reply-' + c.id + '" placeholder="Write a reply... Paste image (Ctrl+V) to attach" rows="1" onpaste="handlePasteImage(event,\'cm-reply-preview-' + c.id + '\',function(p){document.getElementById(\'f-reply-img-' + c.id + '\').value=p})"></textarea><input type="hidden" id="f-reply-img-' + c.id + '" value=""><button class="btn btn-sm btn-primary" style="align-self:flex-end" onclick="addComment(' + postId + ',' + c.id + ')">Reply</button></div><div id="cm-reply-preview-' + c.id + '" style="margin-bottom:8px;margin-left:38px"></div>';
    html += '</div></div>';
  });
  return html;
}

function showReplyForm(commentId, postId) {
  var el = document.getElementById('cm-reply-form-' + commentId);
  if (el) el.style.display = el.style.display === 'none' ? 'flex' : 'none';
}

async function addComment(postId, parentId) {
  var inputId = parentId ? 'f-reply-' + parentId : 'f-new-comment-' + postId;
  var content = document.getElementById(inputId)?.value?.trim();
  if (!content) { alert('Please write something.'); return; }
  var imgInputId = parentId ? 'f-reply-img-' + parentId : 'f-comment-img-' + postId;
  var image_url = (document.getElementById(imgInputId)?.value) || null;
  await ensureBannedCache();
  var violations = checkBannedContent(content);
  if (violations.length > 0) {
    var msg = 'Your comment contains inappropriate language.';
    if (violations[0].severity === 'severe') msg = 'Severe language detected. Comment blocked.';
    alert(msg); return;
  }
  var { error } = await sb.from('community_comments').insert({ post_id: postId, user_id: currentUser.id, content: content, parent_id: parentId || null, image_url: image_url });
  if (error) { alert('Error: ' + error.message); return; }
  document.getElementById(inputId).value = '';
  if (imgInputId) { var imgEl = document.getElementById(imgInputId); if (imgEl) imgEl.value = ''; }
  var previewId = parentId ? 'cm-reply-preview-' + parentId : 'cm-comment-preview-' + postId;
  var prev = document.getElementById(previewId); if (prev) prev.innerHTML = '';
  var idx = _cmPosts.findIndex(function(p) { return p.id === postId; });
  if (idx >= 0 && _cmPosts[idx].comments?.[0]) _cmPosts[idx].comments[0].count = (_cmPosts[idx].comments[0].count || 0) + 1;
  applyCommunityFilters();
  loadComments(postId);
}

async function toggleLike(postId, btn) {
  if (!currentUser) { alert('Please log in.'); return; }
  if (_cmUserLikes[postId]) {
    await sb.from('community_likes').delete().eq('user_id', currentUser.id).eq('post_id', postId);
    delete _cmUserLikes[postId];
    if (btn) { btn.classList.remove('liked'); btn.innerHTML = '♡ <span id="cm-like-count-' + postId + '">' + (parseInt(btn.textContent.match(/\d+/)?.[0] || '1') - 1) + '</span>'; }
    var idx = _cmPosts.findIndex(function(p) { return p.id === postId; });
    if (idx >= 0 && _cmPosts[idx].likes?.[0]) _cmPosts[idx].likes[0].count = Math.max(0, (_cmPosts[idx].likes[0].count || 0) - 1);
  } else {
    var { error } = await sb.from('community_likes').insert({ user_id: currentUser.id, post_id: postId });
    if (error && error.code === '23505') return;
    _cmUserLikes[postId] = true;
    if (btn) { btn.classList.add('liked'); btn.innerHTML = '♥ <span id="cm-like-count-' + postId + '">' + (parseInt(btn.textContent.match(/\d+/)?.[0] || '0') + 1) + '</span>'; }
    var idx = _cmPosts.findIndex(function(p) { return p.id === postId; });
    if (idx >= 0 && _cmPosts[idx].likes?.[0]) _cmPosts[idx].likes[0].count = (_cmPosts[idx].likes[0].count || 0) + 1;
  }
  applyCommunityFilters();
}

async function toggleSolved(postId) {
  if (!currentUser) return;
  var { data: post } = await sb.from('community_posts').select('is_solved').eq('id', postId).single();
  if (!post) return;
  await sb.from('community_posts').update({ is_solved: !post.is_solved }).eq('id', postId);
  hideModal();
  showPostDetail(postId);
}

async function togglePin(postId) {
  if (!currentUser || userProfile?.role !== 'teacher') return;
  var { data: post } = await sb.from('community_posts').select('is_pinned').eq('id', postId).single();
  if (!post) return;
  await sb.from('community_posts').update({ is_pinned: !post.is_pinned }).eq('id', postId);
  hideModal();
  showPostDetail(postId);
}

async function markVerifiedAnswer(commentId, postId) {
  if (!currentUser || userProfile?.role !== 'teacher') return;
  await sb.from('community_comments').update({ is_verified_answer: true }).eq('id', commentId);
  loadComments(postId);
}

async function deleteComment(commentId, postId) {
  if (!confirm('Delete this comment?')) return;
  await sb.from('community_comments').delete().eq('id', commentId);
  loadComments(postId);
}

function reportPostModal(postId) {
  var h = '<h2 style="margin-bottom:12px">Report Post</h2>';
  h += '<p style="font-size:.875rem;color:var(--muted);margin-bottom:12px">Why are you reporting this post?</p>';
  h += '<div class="cm-report-form"><textarea id="f-report-reason" placeholder="Provide a reason..." rows="3"></textarea></div>';
  h += '<div class="admin-modal-footer"><button class="btn btn-primary" onclick="submitReport(' + postId + ')">Submit Report</button><button class="btn btn-ghost" onclick="hideModal()">Cancel</button></div>';
  showModal(h);
}

async function submitReport(postId) {
  var reason = document.getElementById('f-report-reason')?.value?.trim();
  if (!reason) { alert('Please provide a reason.'); return; }
  var { error } = await sb.from('community_reports').insert({ user_id: currentUser.id, post_id: postId, reason: reason });
  if (error) { alert('Error: ' + error.message); return; }
  hideModal();
  alert('Report submitted. Our team will review it shortly.');
}

async function showTopCommunityQuestions(lid, title) {
  var { data: posts } = await sb.from('community_posts').select('*, likes:community_likes(count), comments:community_comments(count)').eq('lesson_id', lid).order('created_at', { ascending: false });
  if (!posts || posts.length === 0) { alert('No community questions for this lesson yet.'); return; }
  posts.sort(function(a,b) {
    var aScore = (a.likes?.[0]?.count||0) * 2 + (a.comments?.[0]?.count||0);
    var bScore = (b.likes?.[0]?.count||0) * 2 + (b.comments?.[0]?.count||0);
    return bScore - aScore;
  });
  var topQ = posts.slice(0, 5);
  var h = '<h2 style="margin-bottom:16px">Top Questions — ' + esc(title) + '</h2>';
  for (var i = 0; i < topQ.length; i++) {
    var p = topQ[i];
    var lc = p.likes?.[0]?.count || 0;
    var cc = p.comments?.[0]?.count || 0;
    var solved = p.is_solved ? ' ✓' : '';
    h += '<div style="padding:12px;border:1px solid var(--border);border-radius:var(--radius);margin-bottom:8px;cursor:pointer" onclick="hideModal();showPostDetail(' + p.id + ')">';
    h += '<div style="font-weight:600;font-size:.875rem;margin-bottom:4px">' + esc(p.title) + solved + '</div>';
    h += '<div style="font-size:.75rem;color:var(--muted)">♥ ' + lc + ' · 💬 ' + cc + '</div>';
    h += '</div>';
  }
  h += '<div class="admin-modal-footer"><button class="btn btn-ghost" onclick="hideModal()">Close</button></div>';
  showModal(h);
}

// ========== NOTIFICATIONS ==========
var _notifTimer = null;

function updateNotifUI() {
  var wrap = document.getElementById('nv-notif-wrap');
  if (!wrap) return;
  if (currentUser) {
    wrap.style.display = 'flex';
    loadNotifCount();
    if (!_notifTimer) _notifTimer = setInterval(loadNotifCount, 30000);
  } else {
    wrap.style.display = 'none';
    if (_notifTimer) { clearInterval(_notifTimer); _notifTimer = null; }
  }
}

async function loadNotifCount() {
  if (!currentUser) return;
  var { count, error } = await sb.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', currentUser.id).eq('is_read', false);
  if (error) { console.error('Notif count error:', error); return; }
  var badge = document.getElementById('nv-notif-badge');
  if (!badge) return;
  if (count && count > 0) { badge.textContent = count > 99 ? '99+' : count; badge.style.display = 'flex'; }
  else { badge.style.display = 'none'; }
}

async function toggleNotifPanel() {
  var panel = document.getElementById('nv-notif-panel');
  if (!panel) return;
  var isOpen = panel.classList.contains('open');
  document.querySelectorAll('.nv-notif-panel.open').forEach(function(p) { p.classList.remove('open'); });
  if (!isOpen) {
    panel.classList.add('open');
    await loadNotifications();
  }
}

async function loadNotifications() {
  var list = document.getElementById('nv-notif-list');
  if (!list || !currentUser) return;
  var { data: notifs } = await sb.from('notifications').select('*, actor:actor_id(name,profile_pic)').eq('user_id', currentUser.id).order('created_at', { ascending: false }).limit(20);
  if (!notifs || notifs.length === 0) { list.innerHTML = '<div class="nv-notif-empty">No notifications yet</div>'; return; }
  var html = '';
  notifs.forEach(function(n) {
    var icons = { like: '♥', comment: '💬', reply: '💬', verified_answer: '✓' };
    var labels = { like: 'liked your post', comment: 'commented on your post', reply: 'replied to your comment', verified_answer: 'verified your answer' };
    var iconClass = n.type;
    var actorName = n.actor?.name || 'Someone';
    var unreadClass = n.is_read ? '' : ' unread';
    html += '<div class="nv-notif-item' + unreadClass + '" onclick="markNotifRead(' + n.id + ',' + (n.post_id || 'null') + ',this)">';
    html += '<div class="nv-notif-icon ' + iconClass + '">' + (icons[n.type] || '•') + '</div>';
    html += '<div class="nv-notif-body"><div class="nv-notif-text"><strong>' + esc(actorName) + '</strong> ' + (labels[n.type] || 'interacted with your post') + '</div><div class="nv-notif-time">' + timeAgo(n.created_at) + '</div></div>';
    html += '</div>';
  });
  list.innerHTML = html;
}

async function markNotifRead(id, postId, el) {
  await sb.from('notifications').update({ is_read: true }).eq('id', id);
  if (el) el.classList.remove('unread');
  loadNotifCount();
  if (postId) { document.getElementById('nv-notif-panel')?.classList.remove('open'); showPostDetail(postId); }
}

// Close notif panel on outside click
document.addEventListener('click', function(e) {
  var wrap = document.getElementById('nv-notif-wrap');
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById('nv-notif-panel')?.classList.remove('open');
  }
});

// ========== SUPPORT PAGE ==========
async function showSupportPage() {
  var el = document.getElementById('support-content');
  if (!currentUser) { el.innerHTML = '<div style="text-align:center;padding:48px;color:var(--muted)">Please log in to access support.</div>'; return; }
  var h = '<div class="sp-header"><h2>Support</h2><p>Contact the admin team for help with device limits or any other issues.</p></div>';
  h += '<div class="sp-form"><h3>Submit a Ticket</h3>';
  h += '<input id="f-ticket-subject" class="auth-input" placeholder="Subject" maxlength="200">';
  h += '<textarea id="f-ticket-message" class="auth-input" placeholder="Describe your issue in detail..." rows="4" maxlength="5000" style="resize:vertical;min-height:100px;font-family:inherit"></textarea>';
  h += '<button class="btn btn-primary" onclick="createSupportTicket()" style="width:100%;justify-content:center">Submit Ticket</button></div>';
  h += '<div class="sp-list"><h3>My Tickets</h3><div id="sp-tickets-list"><div style="text-align:center;padding:24px;color:var(--muted)">Loading…</div></div></div>';
  el.innerHTML = h;
  loadSupportTickets();
}
async function createSupportTicket() {
  var subject = document.getElementById('f-ticket-subject')?.value?.trim();
  var message = document.getElementById('f-ticket-message')?.value?.trim();
  if (!subject || subject.length < 3) { alert('Please enter a subject (at least 3 characters).'); return; }
  if (!message) { alert('Please describe your issue.'); return; }
  var { error } = await sb.from('support_tickets').insert({ user_id: currentUser.id, subject: subject, message: message });
  if (error) { alert('Error: ' + error.message); return; }
  document.getElementById('f-ticket-subject').value = '';
  document.getElementById('f-ticket-message').value = '';
  alert('Ticket submitted! We will respond soon.');
  loadSupportTickets();
}
async function loadSupportTickets() {
  var list = document.getElementById('sp-tickets-list');
  if (!list) return;
  var { data: tickets } = await sb.from('support_tickets').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false });
  if (!tickets || tickets.length === 0) { list.innerHTML = '<div style="text-align:center;padding:24px;color:var(--muted);font-size:.875rem">No tickets yet.</div>'; return; }
  var h = '';
  tickets.forEach(function(t) {
    var statusClass = 'sp-status-' + t.status;
    var statusLabels = { open: 'Open', admin_replied: 'Replied', resolved: 'Resolved', closed: 'Closed' };
    h += '<div class="sp-ticket"><div class="sp-ticket-head"><span class="sp-ticket-subject">' + esc(t.subject) + '</span><span class="sp-ticket-status ' + statusClass + '">' + (statusLabels[t.status] || t.status) + '</span></div>';
    h += '<div class="sp-ticket-message">' + esc(t.message) + '</div>';
    if (t.admin_reply) h += '<div class="sp-ticket-reply"><strong>Admin Reply:</strong><br>' + esc(t.admin_reply) + '</div>';
    h += '<div class="sp-ticket-meta">' + timeAgo(t.created_at) + '</div>';
    if (t.status === 'open' || t.status === 'admin_replied') {
      h += '<button class="btn btn-ghost btn-sm" style="color:var(--error);font-size:.75rem;margin-top:8px" onclick="closeSupportTicket(' + t.id + ')">Close Ticket</button>';
    }
    h += '</div>';
  });
  list.innerHTML = h;
}
async function closeSupportTicket(tid) {
  if (!confirm('Close this ticket?')) return;
  await sb.from('support_tickets').update({ status: 'resolved' }).eq('id', tid);
  loadSupportTickets();
}
