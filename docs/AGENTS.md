# AGENTS.md — Mr Maths

## Stack
- **Frontend**: Vanilla HTML/CSS/JS — no build tools, no npm, no framework
- **Backend**: Supabase (PostgreSQL + Auth + REST API)
- `index.html` (6 view divs + auth modal), `style.css` (all CSS), `script.js` (all JS + Supabase client)
- `admin.html` (standalone admin panel with Supabase client)
- `labels.js` (independent, toggleable overlay for layout-debug)

## Supabase
- Project URL: `https://usllnkoqqpfynsiprvqh.supabase.co`
- anon key in `script.js` and `admin.html` — safe for client-side use (RLS-protected)
- **Auth**: email/password — auto-creates profile row on signup via trigger
- **RLS**: public read for content, authenticated read/write for own progress, admin full access

### Tables
```
courses     → id, title, image_url, description, icon, sort_order
lessons     → id, course_id(FK), title, topic, description, sort_order
lectures    → id, lesson_id(FK), title, content, math, type(Video|Reading|Worksheet), sort_order
homework    → id, lesson_id(FK,unique), pass_score
hw_questions→ id, homework_id(FK), question, options(jsonb), correct(int), sort_order
exams       → id, lesson_id(FK,unique), pass_score
exam_questions→ id, exam_id(FK), question, options(jsonb), correct(int), sort_order
profiles    → id(uuid,PK→auth.users), name, role(student|admin)
progress    → id, user_id(FK→profiles), lesson_id(FK), hw_score, exam_score, exam_completed, hw_result(jsonb), exam_result(jsonb)
```

## Dev Server
```
node server.js          # static server on port 3000
```
- `server.js` hardcodes `E:\New folder` as root — change this if the project moves
- No auto-reload; browser hard refresh required after edits
- All file changes require refresh: `index.html`, `style.css`, `script.js`, `admin.html`

## Architecture

### Data flow
```
Browser (script.js) → Supabase REST API (PostgREST) → PostgreSQL
  - fetchCourses() called on init, cached in COURSES[]
  - Progress loaded from Supabase on login, cached in Progress{}
  - saveProgress() fires async upsert to Supabase (fire-and-forget)
```

### Init sequence (`initApp()`)
1. Check `sb.auth.getSession()` → restore session if exists
2. If logged in: load profile + progress from Supabase
3. `fetchCourses()` → transforms raw Supabase rows into COURSES[] with Arabic keys
4. `updateAuthUI()` → shows Login button or user avatar
5. `showView('landing')`

### Data model (after transform)
```
COURSES[] → { id, title, img, desc, icon, lessons[] }
  lessons[] → { id, title, topic, desc,
    شرح[] (Lecture),      ← Arabic keys preserved for section lookup
    واجب{ passScore, questions[] } (Homework),
    امتحان{ passScore, questions[] } (Exam)
  }
```
- Each `شرح` item has `type` field: `'Video'`, `'Reading'`, or `'Worksheet'`
- Type badges shown next to lesson title (`.lr-title`) + per-item in section rows

### View system
- `showView(view, data)` hides all 6 views, shows target
- Views: `landing`, `platform`, `courses`, `quiz`, `content`, `profile`
- `courses-view` and `content-view` lack `display:none` — managed via inline styles

### JS-rendered content (gotchas)
- All course/lesson/quiz content is `innerHTML` template literals — edits go in `script.js`
- Accordion single-open: `toggleCourse()` and `toggleLessonContent()` enforce one-at-a-time

### Quiz system (Homework & Exam)
- Both `واجب` and `امتحان` are quiz objects: `{ passScore, questions: [{ q, opts[], correct }] }`
- State: `quizState { lessonId, type ('hw'|'exam'), questions, total, answers[], submitted }`
- All questions render at once. Submit button at bottom. Full report on submit.
- `startHW(lid)` / `startExam(lid)` entry points — require auth
- Progress saved to Supabase via `saveProgress()` (fire-and-forget upsert)
- Homework score in `Progress[id].hwScore`; exam in `Progress[id].completed/score`
- Exam unlocks only when `hwScore >= واجب.passScore`
- **View Result**: Shows saved report `{answers[], score, total}` via `viewHW()`/`viewExam()`
- **Next Lesson**: After exam, "Next Lesson →" auto-opens next lesson via `goToNextLesson(lid)`

### Lock/unlock system
- First lesson always unlocked
- Next lesson unlocks when previous lesson exam score ≥ `passScore` (default 60%)

### Design tokens (CSS custom properties in `:root`)
- All colors use OKLCH — never hex for new tokens
- `--bg` (white), `--surface` (warm off-white), `--ink` (near-black), `--primary` (amber-gold), `--accent` (navy), `--success`/`--error`/`--warning`
- `--font`: Inter, system-ui fallback — single family everywhere

### Type badge classes (`.cs-type`)
- `cs-video`: accent (navy fill)
- `cs-reading`: neutral (surface-2)
- `cs-worksheet`: primary (amber fill)
- `cs-exam`: success (green fill)

## Admin Panel (`admin.html`)
- Standalone page, linked from main nav or direct `/admin.html`
- Login: email/password via Supabase Auth, checks profile.role = 'admin'
- **Dashboard tab**: stats cards (total courses, lessons, students, completion rate, avg score)
- **Courses tab**: list courses, add/edit/delete, expand to see lessons with ▲▼ reorder buttons
- **Lesson content modal**: switch tabs for Lectures (type + sort), Homework questions (editable pass_score), Exam questions (editable pass_score)
- **Students tab**: list all students, search by name, show ALL lessons per student (completed or not) with HW/Exam scores, Export CSV button
- **Admins tab**: list admins, remove admin role
- Uses same Supabase client + Supabase REST API for all CRUD

## Constraints
- **Don't**: gradient text, glassmorphism, side-stripe borders, numbered scaffolds, animate-on-img
- Brand: "Premium 1-on-1 math mastery"
- UI labels in English only (Lecture, Homework, Exam, Open, Start, Back to Courses)

## Commands
```
node server.js          # dev server, workdir must be project root
node --check script.js  # syntax check only
```

## Key Files
- `E:\New folder\database_final.sql` — complete schema + seed + triggers + RLS
- `E:\New folder\script.js` — main app with Supabase client + auth + quiz
- `E:\New folder\admin.html` — standalone admin panel with CRUD
- `E:\New folder\index.html` — 6 views + auth modal + Supabase CDN
- `E:\New folder\style.css` — all design tokens + component styles (~450 lines)
