---
name: exam-platform-review
description: "Use this skill whenever the user asks to review, audit, check, or find bugs/issues in this exam/educational platform's codebase (index.html, admin.html, script.js, style.css, animengine.min.js, or any file under database/). Triggers include: 'راجعلي الكود', 'في مشاكل؟', 'افحص المشروع', 'security review', 'code review', 'قبل ما اعمل commit', or any request to inspect this repo for security, bugs, or code quality issues. Also use before commits or major merges touching these files. Do NOT use this skill for unrelated projects or for creating new unrelated features from scratch."
license: Personal use
---

# Exam Platform Code Review

Review skill for a student exam/quiz platform. Stack: static frontend
(`index.html`, `admin.html`, `script.js`, `style.css`, `animengine.min.js`),
Supabase backend (Postgres + Auth + RLS), SQL migrations under `database/`.
No build step / no framework — plain JS talking to Supabase client-side.

Because the Supabase client and its anon key live in the browser bundle,
**this codebase's entire security model rests on RLS policies and
server-side (Edge Function / RPC) checks — never on JS logic.** Review with
that assumption first; everything else is secondary.

## Review process

1. **Read context first, every time:**
   - `docs/AGENTS.md`, `docs/PRODUCT.md`, `docs/DESIGN.md` if present — understand
     intended roles (student/admin), grading rules, and any documented
     constraints before flagging something as a "bug."
   - `database/*.sql` in filename order (migrations are incremental — read
     `database_final.sql` first for the baseline schema, then each
     `migration_*.sql` to see what changed and why).

2. **Map the attack surface before reading line-by-line:**
   - `grep -n "supabase" script.js admin.html index.html` — every table/RPC
     the client touches.
   - `grep -n "SUPABASE_URL\|SUPABASE_ANON_KEY\|service_role\|SUPABASE_SERVICE" -r .`
     — confirm no `service_role` key is anywhere in client-shipped files
     (`index.html`, `admin.html`, `script.js`). `service_role` in any of
     these three is a **critical** finding — it bypasses RLS entirely.
   - `grep -n "innerHTML\|outerHTML\|document.write\|eval(\|dangerouslySetInnerHTML"`
     across JS/HTML — candidate XSS injection points, especially anywhere
     that renders a student's name, answer text, or free-response input.

3. **Then review each area below.** Don't just read top-to-bottom — grep for
   the patterns listed, then read the surrounding function for context.

## Security checklist

### Supabase / RLS (highest priority)
- [ ] Every table holding student data, answers, or scores has RLS **enabled**
      (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` present in migrations).
      A table with RLS *disabled* and a public anon key is a full data leak —
      flag this as critical, not a style note.
- [ ] Policies actually scope by user: check for `auth.uid() = user_id`-style
      conditions, not `USING (true)` on anything beyond genuinely public
      reference data (e.g. published question banks with no answer key).
- [ ] Answer keys / correct answers are not readable by the student role
      before or during an active attempt — check whether the `SELECT` policy
      on the questions/answers table filters out the correct-answer column
      or gates it by attempt status.
- [ ] Grading, score calculation, and "is this answer correct" logic lives in
      a database function / RPC / Edge Function, not in `script.js`. If
      correctness is computed client-side and only the final score is
      submitted, that's a critical trust-boundary bug — a student can submit
      any score.
- [ ] Admin-only actions (banning users, editing questions, viewing all
      results) are enforced by RLS/RPC checking a role claim — not just by
      hiding the admin UI in `admin.html`. Anyone can open `admin.html`
      directly or call the same Supabase queries from devtools.
- [ ] Check `migration_admin_reset.sql` and `migration_banned_words.sql`
      specifically for policies that might be overly permissive resets left
      over from debugging.

### XSS / injection
- [ ] Any place student-submitted text (names, free-text answers, community
      posts per `migration_community.sql`) is rendered back via `innerHTML`
      must be escaped/sanitized first. Flag raw `innerHTML = someUserValue`.
- [ ] `migration_banned_words.sql` suggests a profanity/content filter —
      confirm it's enforced server-side (constraint/trigger/RLS check), not
      just filtered in JS before display (client-side-only filtering is
      bypassable and not a real control).
- [ ] No raw string concatenation building SQL anywhere (should be N/A with
      Supabase's query builder/RPC, but check any raw `sql\`...\`` or
      `.rpc()` calls that interpolate user input into a query string).

### Auth
- [ ] Session/token handling: no JWT or password ever logged to console or
      stored in `localStorage` in a way that's readable by injected scripts
      unnecessarily (Supabase's default client storage is generally fine —
      flag only custom/manual token handling).
- [ ] Rate limiting or attempt-count enforcement for exams
      (`migration_questions_per_attempt.sql`) is checked server-side, not
      just by disabling a button in the UI after first submit.

## Bug-pattern checklist (script.js, admin.html)

- [ ] **Race conditions in exam timing:** timer logic, auto-submit on
      timeout, and "attempt already used" checks — look for cases where a
      network delay or double-click could submit twice or bypass the timer.
- [ ] **Off-by-one / boundary issues** in question navigation, scoring
      (`migration_math.sql`, `migration_levels.sql` suggest scored/leveled
      content — check level-threshold comparisons for `<` vs `<=`).
- [ ] **Unhandled promise rejections** around Supabase calls — every
      `.from(...).select()/.insert()/.update()` should check `error`, not
      just destructure `data` and assume success.
- [ ] **Duplicate event listeners** from re-rendering without cleanup
      (common in vanilla-JS SPAs without a framework's diffing) — look for
      `addEventListener` inside functions that get called more than once on
      the same element without a matching `removeEventListener`.
- [ ] **Image/media handling** (`migration_image_exam.sql`,
      `migration_question_images.sql`, `migration_video.sql`): verify
      uploaded file types/sizes are validated before upload, and that
      Supabase Storage bucket policies match the same access rules as the
      DB (a public bucket serving "hidden" exam images defeats RLS on the
      questions table).
- [ ] **`animengine.min.js`** is a minified third-party/vendor lib — don't
      spend review time inside it; just confirm it isn't loaded from a
      remote CDN without SRI (should be the local vendored copy).

## Code quality checklist

- [ ] `script.js` (161 KB, single file) — check whether it's organized into
      clear sections/modules (even without a bundler, IIFEs or clear comment
      banners help) or if it's an unstructured dump. Note but don't
      necessarily force a full refactor unless asked.
- [ ] `admin.html` (230 KB) — inline `<script>`/`<style>` of this size is a
      maintainability smell; note whether logic here duplicates
      `script.js` (copy-pasted functions that will drift out of sync).
- [ ] Dead code / commented-out blocks left from AI-assisted generation
      (common artifact — check for large commented blocks, `console.log`
      debug statements left in, unused variables).
- [ ] Consistent error-surfacing to the user (Arabic-language UI — confirm
      error messages shown to students/admins are in Arabic and don't leak
      raw Postgres/Supabase error text).

## Output format

Report findings grouped by severity, not by file:

1. **Critical** (data exposure, grading bypass, auth bypass) — each with the
   exact file:line, why it's exploitable, and the minimal fix.
2. **High** (XSS, missing validation, race conditions affecting scores).
3. **Medium** (missing error handling, RLS gaps on low-sensitivity tables).
4. **Low / code quality** (organization, dead code, duplication).

For each finding, show the offending snippet, explain the concrete exploit
scenario (e.g. "a student opens devtools, calls
`supabase.from('answers').select('correct_option')` directly, and reads the
answer key before submitting"), then give the fix — prefer an RLS
policy/migration fix over a JS-only patch when the root cause is a missing
server-side check.

Don't flag client-side conveniences (e.g. disabling a button, hiding admin
nav) as the *primary* bug if there's no corresponding server-side gap — note
them as UX-only unless the server-side check is also missing.
