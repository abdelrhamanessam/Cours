const SUPABASE_URL = 'https://usllnkoqqpfynsiprvqh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzbGxua29xcXBmeW5zaXBydnFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3MTYxMzgsImV4cCI6MjA5OTI5MjEzOH0.JbWJo9S7phVksNx8ib8zXY6QkHy-6FpLT-vDedEFp_g';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let userProfile = null;
let COURSES = [];
let Progress = {};
let currentLessonId = null;
let quizState = null;

initApp();

async function initApp() {
  const { data: { session } } = await sb.auth.getSession();
  currentUser = session?.user || null;
  if (currentUser) await loadUserAndProgress();
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
        title: lec.title, content: lec.content, math: lec.math, type: lec.type, video_url: lec.video_url || '', file_url: lec.file_url || '', pdf_url: lec.pdf_url || ''
      })),
      واجب: {
        passScore: l.homework?.pass_score || 60,
        questions: (l.homework?.hw_questions || []).sort((a,b) => (a.sort_order||0) - (b.sort_order||0)).map(q => ({ id: q.id, q: q.question, opts: q.options, correct: q.correct, math: q.math || '', image_url: q.image_url || '', option_images: q.option_images || [] })),
        imageQuestions: (l.homework?.hw_image_questions || []).sort((a,b) => (a.sort_order||0) - (b.sort_order||0)).map(q => ({ id: q.id, imgQ: q.image_url, correct: q.correct, explanation: q.explanation || '' }))
      },
      امتحان: {
        passScore: l.exams?.pass_score || 60,
        totalQuestions: l.exams?.total_questions || 0,
        maxAttempts: l.exams?.max_attempts || 0,
        attemptPassScore: l.exams?.attempt_pass_score || 60,
        hasFinalExam: l.exams?.has_final_exam || false,
        questionsPerAttempt: l.exams?.questions_per_attempt || 0,
        questions: (l.exams?.exam_questions || []).sort((a,b) => (a.sort_order||0) - (b.sort_order||0)).map(q => ({ id: q.id, q: q.question, opts: q.options, correct: q.correct, math: q.math || '', image_url: q.image_url || '', option_images: q.option_images || [] })),
        imageQuestions: (l.exams?.exam_image_questions || []).sort((a,b) => (a.sort_order||0) - (b.sort_order||0)).map(q => ({ id: q.id, imgQ: q.image_url, correct: q.correct, explanation: q.explanation || '' }))
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
    var btn = document.createElement('button');
    btn.className = 'btn btn-ghost btn-sm';
    btn.onclick = function() { signOut(); };
    btn.textContent = 'Sign Out';
    el.appendChild(btn);
  } else {
    el.innerHTML = '<button class="btn btn-primary btn-sm" onclick="showAuthModal()">Log In</button>';
  }
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
  hideAuthModal();
  updateAuthUI();
  renderProfile();
  renderCourses();
  renderPlatform();
}

async function signUp() {
  const email = document.getElementById('signup-email').value;
  const password = document.getElementById('signup-password').value;
  const name = document.getElementById('signup-name').value;
  const level = document.getElementById('signup-level')?.value || 'sec1';
  const { error } = await sb.auth.signUp({ email, password, options: { data: { name, level } } });
  if (error) { alert(error.message); return; }
  alert('Check your email to confirm your account.');
  hideAuthModal();
}

async function signOut() {
  await sb.auth.signOut();
  currentUser = null; userProfile = null; Progress = {};
  updateAuthUI(); renderProfile(); renderCourses();
}
async function updateProfileLevel() {
  const level = document.getElementById('profile-level-select')?.value;
  if (!level || !currentUser) return;
  const { error } = await sb.from('profiles').update({ level }).eq('id', currentUser.id);
  if (error) { alert(error.message); return; }
  if (userProfile) userProfile.level = level;
  renderProfile();
  renderCourses();
}

function renderProfile() {
  const el = document.getElementById('profile-card');
  if (!el) return;
  if (!currentUser) {
    document.getElementById('profile-avatar').innerHTML = '?';
    document.getElementById('profile-name').textContent = 'Not signed in';
    document.getElementById('profile-email').textContent = 'Sign in to see your progress';
    document.getElementById('pm-quizzes').textContent = '0';
    document.getElementById('pm-avg').textContent = '—';
    document.getElementById('profile-progress-list').innerHTML = '<p style="color:var(--muted);font-size:.875rem"><a href="#" onclick="showAuthModal();return false">Sign in</a> to track progress.</p>';
    document.getElementById('profile-level-wrap').innerHTML = '';
    return;
  }
  const init = (userProfile?.name || 'U').charAt(0).toUpperCase();
  const avatarEl = document.getElementById('profile-avatar');
  avatarEl.textContent = '';
  if (userProfile?.profile_pic) {
    var img = document.createElement('img');
    img.src = userProfile.profile_pic;
    img.alt = 'Profile photo';
    avatarEl.appendChild(img);
  } else {
    avatarEl.textContent = init;
  }
  document.getElementById('profile-name').textContent = userProfile?.name || 'User';
  document.getElementById('profile-email').textContent = currentUser.email || '';
  const level = userProfile?.level || 'sec1';
  document.getElementById('profile-level-wrap').innerHTML = '<select id="profile-level-select" onchange="updateProfileLevel()"><option value="sec1"'+(level==='sec1'?' selected':'')+'>Secondary 1</option><option value="sec2"'+(level==='sec2'?' selected':'')+'>Secondary 2</option><option value="sec3"'+(level==='sec3'?' selected':'')+'>Secondary 3</option></select>';
  const entries = Object.entries(Progress);
  const done = entries.filter(([,v]) => v.completed).length;
  const avg = entries.filter(([,v]) => v.score != null);
  const avgScore = avg.length ? Math.round(avg.reduce((s, [,v]) => s + v.score, 0) / avg.length) : null;
  const levelCourses = COURSES.filter(c => c.level === level);
  const totalLessons = levelCourses.reduce((s, c) => s + c.lessons.length, 0);
  document.getElementById('pm-quizzes').textContent = done + '/' + totalLessons;
  document.getElementById('pm-avg').textContent = avgScore != null ? avgScore + '%' : '—';
  let ph = '';
  levelCourses.forEach(c => {
    c.lessons.forEach(l => {
      const p = Progress[l.id];
      const score = p?.score || 0;
      const cls = p?.completed ? '' : ' pending';
      ph += '<div class="pv-progress-row' + cls + '"><span class="pv-progress-row-title">' + esc(l.title) + '</span><span class="pv-progress-row-score">' + (p?.completed ? score + '%' : '—') + '</span><div class="pv-progress-row-bar"><div class="pv-progress-row-fill" style="width:' + (p?.completed ? score : 0) + '%"></div></div></div>';
    });
  });
  document.getElementById('profile-progress-list').innerHTML = ph ? '<div class="pv-progress-list">' + ph + '</div>' : '<p style="color:var(--muted);font-size:.875rem">Complete a lesson to see progress here.</p>';
}

function uploadProfilePic(event) {
  const file = event.target.files[0];
  if (!file || !currentUser) return;
  const ext = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = 'profiles/' + currentUser.id + '/' + Date.now() + '.' + ext;
  const formData = new FormData();
  formData.append('file', file);
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
    var completedLids = Object.keys(Progress).filter(function(k) { return Progress[k]?.completed; }).map(Number);
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
  var completedLids = Object.keys(Progress).filter(function(lid) { return Progress[lid]?.completed; }).map(Number);
  if (completedLids.length === 0) { alert('Complete at least one lesson first.'); return; }
  // Scale questions per lesson: fewer as more lessons completed
  var perLesson = completedLids.length <= 3 ? 5 : completedLids.length <= 6 ? 4 : completedLids.length <= 10 ? 3 : 2;
  var { data: attempts } = await sb.from('exam_attempts').select('*').eq('user_id', currentUser.id);
  if (!attempts) attempts = [];
  var allQs = [];
  var qOrder = [];
  for (var ci = 0; ci < COURSES.length; ci++) {
    var course = COURSES[ci];
    for (var li = 0; li < course.lessons.length; li++) {
      var lesson = course.lessons[li];
      if (!Progress[lesson.id]?.completed) continue;
      var exam = lesson.امتحان;
      if (!exam) continue;
      // Collect all lesson questions with IDs
      var pool = [];
      (exam.questions || []).forEach(function(q) { pool.push({ id: q.id, type: 'standard', q: q.q, opts: q.opts, correct: q.correct, math: q.math, image_url: q.image_url, option_images: q.option_images }); });
      (exam.imageQuestions || []).forEach(function(q) { pool.push({ id: q.id, type: 'image', imgQ: q.imgQ, correct: q.correct, explanation: q.explanation }); });
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
        if (p.type === 'standard') {
          allQs.push({ qid: qid, qtype: qtype, q: p.q, opts: p.opts, correct: p.correct, math: p.math || '', image_url: p.image_url || '', option_images: p.option_images || [], isImage: false, sourceLid: lesson.id });
        } else {
          var li = p.correct === 'A' ? 0 : p.correct === 'B' ? 1 : p.correct === 'C' ? 2 : p.correct === 'D' ? 3 : 0;
          allQs.push({ qid: qid, qtype: qtype, q: '', opts: ['A', 'B', 'C', 'D'], correct: li, math: '', image_url: '', option_images: [], isImage: true, imgQ: p.imgQ, explanation: p.explanation || '', sourceLid: lesson.id });
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
  // Draw performance chart with sample data
  setTimeout(function() {
    var canvas = document.getElementById('pf-canvas');
    if (canvas) drawPerfChart(canvas);
  }, 50);
}

function drawPerfChart(canvas) {
  var weeks = [];
  for (var w = 0; w < 4; w++) {
    var days = 3 + Math.floor(Math.random() * 3);
    var sc = [];
    for (var d = 0; d < days; d++) {
      var base = 35 + w * 12;
      sc.push(Math.min(100, Math.max(15, base + Math.floor(Math.random() * 30) - 10)));
    }
    var avg = Math.round(sc.reduce(function(s, v) { return s + v; }, 0) / sc.length);
    weeks.push({ label: 'Week ' + (w + 1), scores: sc, avg: avg });
  }
  var allA = weeks.map(function(w) { return w.avg; });
  var oAvg = Math.round(allA.reduce(function(s, v) { return s + v; }, 0) / allA.length);
  var chg = allA[allA.length - 1] - allA[0];
  // Setup canvas
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
  // Plot points
  var pts = weeks.map(function(week, wi) {
    var x = pad.left + (wi / (weeks.length - 1)) * cw;
    return { x: x, y: pad.top + ch - (week.avg / 100) * ch, week: week };
  });
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
    // Outer circle
    ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = prim; ctx.lineWidth = 3; ctx.stroke();
    // Inner dot
    ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fillStyle = prim; ctx.fill();
    // Score above dot
    ctx.fillStyle = ink;
    ctx.font = 'bold 16px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(p.week.avg + '%', p.x, p.y - 16);
    // Week label below
    ctx.fillStyle = mut;
    ctx.font = '13px Inter, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(p.week.label, p.x, pad.top + ch + 8);
    // Session count
    ctx.fillText(p.week.scores.length + ' sessions', p.x, pad.top + ch + 26);
  });
  // Stats
  var se = document.getElementById('pf-stats');
  if (se) {
    se.innerHTML =
      '<div class="pf-stat"><span class="pf-stat-val">' + oAvg + '%</span><span class="pf-stat-lbl">30-Day Average</span></div>' +
      '<div class="pf-stat"><span class="pf-stat-val" style="color:' + (chg >= 0 ? 'var(--success)' : 'var(--error)') + '">' + (chg >= 0 ? '▲ +' : '▼ ') + Math.abs(chg) + '%</span><span class="pf-stat-lbl">Week 1 → Week 4</span></div>' +
      '<div class="pf-stat"><span class="pf-stat-val">' + weeks.reduce(function(s, w) { return s + w.scores.length; }, 0) + '</span><span class="pf-stat-lbl">Sessions Logged</span></div>';
  }
}

function closeMobileNav() {
  var nv = document.getElementById('nv1'); var ov = document.getElementById('nv-overlay');
  if (nv) nv.classList.remove('open'); if (ov) ov.classList.remove('show');
}
function showView(view, data) {
  closeMobileNav();
  document.querySelectorAll('.landing-view, .platform-view, .courses-view, .quiz-view, .content-view, .profile-view, .review-view').forEach(v => v.style.display = 'none');
  if (view === 'landing') document.getElementById('view-landing').style.display = 'block';
  else if (view === 'platform') { document.getElementById('view-platform').style.display = 'block'; renderPlatform(); }
  else if (view === 'courses') { document.getElementById('view-courses').style.display = 'block'; renderCourses(); }
  else if (view === 'quiz') { document.getElementById('view-quiz').style.display = 'block'; }
  else if (view === 'content') { document.getElementById('view-content').style.display = 'block'; renderContentPage(data).catch(()=>{}); }
  else if (view === 'profile') { document.getElementById('view-profile').style.display = 'block'; renderProfile(); }
  else if (view === 'review') { document.getElementById('view-review').style.display = 'block'; renderReviewPage(); }
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

function renderCourses() {
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
      h += '</div></div>';
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
  if (item.type === 'Video' && item.video_url) {
    const v = item.video_url;
    if (!v.includes('youtube.com') && !v.includes('youtu.be') && !v.includes('vimeo.com')) {
      vpInit(v, el.querySelector('.vp-wrap'));
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
      qs.push({ q: '', opts: ['A', 'B', 'C', 'D'], correct: letterIndex, math: '', image_url: '', option_images: [], isImage: true, imgQ: iq.imgQ, explanation: iq.explanation });
    });
  }
  quizState = { lessonId, type, questions: qs, total: qs.length, answers: new Array(qs.length).fill(-1), submitted: false };
  const label = document.getElementById('quiz-type-label');
  if (label) label.textContent = type === 'exam' ? 'Exam' : 'Homework';
  const bar = document.getElementById('quiz-bar');
  const txt = document.getElementById('quiz-progress-text');
  if (bar) bar.style.width = '0%';
  if (txt) txt.textContent = '0/' + qs.length;
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
        return '<div class="quiz-option' + sel + '" data-qi="' + qi + '" data-oi="' + oi + '" onclick="selectAnswer(' + qi + ',' + oi + ')">' + o + '</div>';
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

function submitAll() {
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
      await sb.from('final_exam_attempts').upsert({
        user_id: currentUser.id, lesson_id: lessonId,
        score: score, total: total, answers: result,
        passed: passed
      }, { onConflict: 'user_id, lesson_id' });
    })();
    window._finalExam = { lesson_id: lessonId, score: score, total: total, passed: passed };
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
      (async function() {
        await sb.from('exam_attempts').update({
          score: score, total: total, answers: result, passed: passed
        }).eq('id', attemptId);
        // Check if all attempts used → auto-complete
        var atts = (window._examAttempts[lessonId] || []).filter(function(a) { return a.id !== attemptId; });
        atts.push({ id: attemptId, attempt_number: (window._examAttempts[lessonId] || []).length + 1, score: score, total: total, passed: passed, answers: result });
        window._examAttempts[lessonId] = atts;
        var foundL = getLesson(lessonId);
        if (foundL && foundL.lesson.امتحان.totalQuestions > 0 && atts.length >= foundL.lesson.امتحان.maxAttempts) {
          Progress[lessonId].completed = true;
          Progress[lessonId].progress = 100;
          Progress[lessonId].score = pct;
          Progress[lessonId].lastAttempt = Date.now();
          Progress[lessonId].lastResult = result;
          saveProgress();
        }
      })();
    } else {
      // Legacy exam
      Progress[lessonId].completed = true;
      Progress[lessonId].progress = 100;
      Progress[lessonId].score = pct;
      Progress[lessonId].lastAttempt = Date.now();
      Progress[lessonId].lastResult = result;
      saveProgress();
    }
    renderReport(lessonId, type, quizState.questions, result);
  }
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
        report += '<div class="quiz-option ' + cls + '" style="cursor:default;margin-bottom:6px">' + l + lbl + '</div>';
      });
      if (q.explanation) report += '<div style="margin-top:8px;padding:8px 12px;background:var(--bg);border-radius:var(--radius);font-size:.8125rem;color:var(--muted)">💡 ' + esc(q.explanation) + '</div>';
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
      allQs.push({ q: '', opts: ['A', 'B', 'C', 'D'], correct: letterIndex, math: '', image_url: '', option_images: [], isImage: true, imgQ: iq.imgQ, explanation: iq.explanation });
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
      allQs.push({ q: '', opts: ['A', 'B', 'C', 'D'], correct: letterIndex, math: '', image_url: '', option_images: [], isImage: true, imgQ: iq.imgQ, explanation: iq.explanation });
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
  var stdIds = [];
  var imgIds = [];
  ids.forEach(function(item) {
    if (item.question_type === 'standard') stdIds.push(item.question_id);
    else imgIds.push(item.question_id);
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
  var qs = [];
  ids.forEach(function(item) {
    if (item.question_type === 'standard') {
      var sq = result['std_' + item.question_id];
      if (sq) qs.push({ q: sq.question, opts: sq.options, correct: sq.correct, math: sq.math || '', image_url: sq.image_url || '', option_images: sq.option_images || [], isImage: false });
    } else {
      var iq = result['img_' + item.question_id];
      if (iq) {
        var li = iq.correct === 'A' ? 0 : iq.correct === 'B' ? 1 : iq.correct === 'C' ? 2 : iq.correct === 'D' ? 3 : 0;
        qs.push({ q: '', opts: ['A', 'B', 'C', 'D'], correct: li, math: '', image_url: '', option_images: [], isImage: true, imgQ: iq.image_url, explanation: iq.explanation || '' });
      }
    }
  });
  return qs;
}

async function startDynamicExam(lid) {
  if (!currentUser) { alert('Please log in.'); return; }
  var found = getLesson(lid);
  if (!found) return;
  currentLessonId = lid;
  await initQuestionPool(lid);
  var remaining = await getPoolUnseenCount(lid);
  if (remaining === 0) {
    alert('No more questions available in the pool.');
    return;
  }
  var selected = await selectAttemptQuestions(lid);
  if (!selected || selected.length === 0) return;
  var qs = await loadBatchQuestions(selected);
  if (qs.length === 0) { alert('No questions.'); return; }
  // Get attempt number
  var attempts = (window._examAttempts[lid] || []);
  var attNum = attempts.length + 1;
  // Create attempt record in DB
  // Store question order for reconstructing attempt view
  var qOrder = selected.map(function(s) { return { question_type: s.question_type, question_id: s.question_id }; });
  var { data: att } = await sb.from('exam_attempts').insert({
    user_id: currentUser.id, lesson_id: lid,
    attempt_number: attNum, score: 0, total: qs.length,
    answers: null, passed: false,
    question_order: qOrder
  }).select('id').single();
  if (!att) { alert('Failed to create attempt.'); return; }
  var attemptId = att.id;
  // Mark pool items as seen
  for (var m = 0; m < selected.length; m++) {
    await sb.from('exam_student_pool').update({ seen: true, attempt_id: attemptId })
      .eq('user_id', currentUser.id)
      .eq('lesson_id', lid)
      .eq('question_type', selected[m].question_type)
      .eq('question_id', selected[m].question_id);
  }
  // Update local cache
  if (!window._examAttempts[lid]) window._examAttempts[lid] = [];
  window._examAttempts[lid].push({ id: attemptId, attempt_number: attNum, score: 0, total: qs.length, passed: false, answers: null });
  // Start quiz
  quizState = { lessonId: lid, type: 'exam', questions: qs, total: qs.length, answers: new Array(qs.length).fill(-1), submitted: false, attemptId: attemptId };
  var label = document.getElementById('quiz-type-label');
  if (label) label.textContent = 'Attempt ' + attNum;
  var bar = document.getElementById('quiz-bar');
  var txt = document.getElementById('quiz-progress-text');
  if (bar) bar.style.width = '0%';
  if (txt) txt.textContent = '0/' + qs.length;
  showView('quiz');
  renderAllQuestions();
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
  showView('quiz');
  renderAllQuestions();
}
