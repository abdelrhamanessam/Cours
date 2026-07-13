# Mr Maths — تقرير المشروع الكامل
## منصة تعليمية متكاملة (Mathematics Education Platform)

---

## 1. نظرة عامة

منصة تعليمية تفاعلية لمادة الرياضيات بإشراف الأستاذ عصام إدريس. تشمل:
- صفحات هبوط (Landing) + لوحة تحكم طالب + لوحة تحكم أدمن
- نظام فيديوهات تعليمية مدمج (Custom Video Player)
- نظام اختبارات ديناميكي (Dynamic Exam + Final Exam)
- نظام واجبات منزلية
- نظام مراجعة ذكية (Smart Review) بتحليل الأخطاء
- تصفح دروس مع ملفات PDF ومرفقات
- رفع صور أسئلة مع دعم الرياضيات (KaTeX)

---

## 2. اللغات والتقنيات المستخدمة

### Frontend (SPA بدون Framework)
| التقنية | الاستخدام |
|---------|-----------|
| **HTML5** | هيكل الصفحات (index.html, admin.html) |
| **CSS3** | كل التنسيقات (style.css, ~795 سطر) |
| **Vanilla JavaScript (ES5/ES6)** | كل المنطق (script.js, ~1700 سطر) |

### CDN Libraries (مش NPM — تحميل مباشر من CDN)
| المكتبة | المصدر | الاستخدام |
|---------|--------|-----------|
| Supabase JS v2 | `@supabase/supabase-js@2` | قاعدة البيانات + Auth + Storage |
| KaTeX v0.16.11 | `katex.min.js` + `auto-render.min.js` | عرض المعادلات الرياضية (LaTeX) |
| AnimEngine | `animengine.min.js` | أنيميشن عند التمرير (scroll-triggered) |
| Mammoth.js v1.8 | `mammoth.browser.min.js` | استيراد أسئلة من Word (.docx) |

### NPM Dependencies
| الحزمة | الاستخدام |
|--------|-----------|
| `mammoth` | لاستيراد Word في بيئة Node (بجانب CDN) |

### Backend
| الخدمة | الاستخدام |
|--------|-----------|
| **Supabase** | قاعدة بيانات PostgreSQL + Auth (تسجيل دخول) + Storage (ملفات، صور، فيديوهات) |
| **Node.js** | `server.js` — سيرفر استاتيك بسيط (اختياري، الموقع شغال على file:// أو أي host) |
| **PostgreSQL** | قاعدة البيانات العلائقية |
| **Supabase Edge Functions** | دالة `project-stats` لجلب إحصائيات المشروع |

### التخزين
| Bucket | محتوى | نوع |
|--------|-------|-----|
| `question-images` | صور الأسئلة، صور الكورسات، صور البروفايل، صورة المدرس | Public |
| `videos` | ملفات الفيديو (MP4, WebM) | Private (signed URLs) |
| `files` | ملفات PDF, Word, PPT, zip | Public |

---

## 3. هيكل الملفات

```
E:\New folder\
├── index.html              # التطبيق الرئيسي (7 صفحات)
├── admin.html              # لوحة تحكم الأدمن (7 صفحات إدارة)
├── script.js               # ~1700 سطر — كل منطق التطبيق
├── style.css               # ~795 سطر — كل التنسيقات
├── server.js               # سيرفر Node.js للتشغيل المحلي
├── package.json            # mammoth فقط
│
├── database/
│   ├── database_final.sql  # السكيما الكاملة + seed data
│   ├── migration_*.sql     # ملفات التحديثات (7 ملفات)
│
├── docs/
│   ├── AGENTS.md, DESIGN.md, PRODUCT.md  # وثائق التصميم
│   └── prompt_ai.txt
│
└── assets/                 # صور ثابتة
```

---

## 4. صفحات التطبيق (SPA)

### التطبيق الرئيسي — `index.html`
يتم التبديل بين الصفحات بـ `showView(viewName)`

| الصفحة | ID | الوظيفة |
|--------|----|---------|
| **الرئيسية** | `landing` | هيرو + خطوات العمل + آراء الطلاب + معاينة الكورسات + footer |
| **لوحة الطالب** | `platform` | إحصائيات، استمر التعلم، رسم بياني 30 يوم، آخر النتائج |
| **الكورسات** | `courses` | قائمة كورسات مع دروس قابلة للتوسيع |
| **الاختبار** | `quiz` | محرك الأسئلة (نصي + صوري) مع شريط تقدم |
| **المحتوى** | `content` | عرض الدرس: فيديو، PDF، ملفات، معادلات |
| **البروفايل** | `profile` | صورة شخصية، مستوى دراسي، إحصائيات، تقدم |
| **المراجعة** | `review` | تحليل الأخطاء، ترتيب الدروس الأضعف، عرض الغلطات |

### لوحة الأدمن — `admin.html`
يتم التبديل بـ `switchAdminPage(pageName)`

| الصفحة | ID | الوظيفة |
|--------|----|---------|
| **لوحة التحكم** | `dashboard` | إحصائيات عامة |
| **الكورسات** | `courses` | إدارة كاملة (كورسات + دروس + أسئلة) |
| **المجموعات** | `categories` | بنك أسئلة قابل لإعادة الاستخدام |
| **الطلاب** | `students` | قائمة طلاب + تقدمهم |
| **المشرفين** | `admins` | إدارة المشرفين |
| **النظام** | `stats` | إحصائيات Supabase + قاعدة البيانات |
| **الإعدادات** | `site` | صورة المدرس + نص الهيرو |

---

## 5. قاعدة البيانات (PostgreSQL)

### الجداول الأساسية

```
courses ──1:N── lessons ──1:N── lectures
                  │
                  ├── 1:1 ── homework ──1:N── hw_questions
                  │                        └──1:N── hw_image_questions
                  │
                  ├── 1:1 ── exams ──1:N── exam_questions
                  │                        └──1:N── exam_image_questions
                  │
                  └── 1:N ── exam_student_pool (per user)
                  └── 1:N ── exam_attempts (per user)
                  └── 1:1 ── final_exam_attempts (per user)

profiles ──1:N── progress (per lesson)
          ──1:N── exam_attempts
          ──1:N── exam_student_pool

auth.users ──1:1── profiles (auto-created by trigger)

question_categories ──1:N── category_questions
```

### ملخص الجداول (17 جدول)

| الجدول | المحتوى | RLS |
|--------|---------|-----|
| `courses` | الكورسات | Public read, Admin write |
| `lessons` | الدروس | Public read, Admin write |
| `lectures` | المحاضرات (فيديو/PDF/ملف) | Public read, Admin write |
| `homework` | إعدادات الواجب (1 لكل درس) | Public read, Admin write |
| `hw_questions` | أسئلة الواجب النصية | Public read, Admin write |
| `hw_image_questions` | أسئلة الواجب المصورة (A/B/C/D) | Public read, Admin write |
| `exams` | إعدادات الامتحان (1 لكل درس) | Public read, Admin write |
| `exam_questions` | أسئلة الامتحان النصية | Public read, Admin write |
| `exam_image_questions` | أسئلة الامتحان المصورة | Public read, Admin write |
| `profiles` | ملفات المستخدمين (طلاب + أدمن) | Authenticated read |
| `progress` | تقدم الطالب لكل درس | Private per user |
| `exam_student_pool` | بنك أسئلة الامتحان الديناميكي | Private per user |
| `exam_attempts` | محاولات الامتحانات | Private per user |
| `final_exam_attempts` | الامتحان النهائي | Private per user |
| `question_categories` | مجموعات الأسئلة | Public read, Admin write |
| `category_questions` | أسئلة المجموعات | Public read, Admin write |
| `site_config` | إعدادات الموقع (key-value) | Public read, Admin write |

### ملاحظة مهمة
- `lesson_id` في جدول `exam_attempts` عادي يكون NULL (للمراجعات الذكية — Smart Review)
- كل الأسئلة لها `sort_order` للترتيب
- JSONB يستخدم لتخزين: قائمة الخيارات (`options`)، إجابات المستخدم (`answers`)، ترتيب الأسئلة (`question_order`)

---

## 6. نظام الحماية (RLS — Row Level Security)

| النوع | القاعدة |
|-------|---------|
| **جداول المحتوى** (courses, lessons, exams, homework, questions) | أي واحد يقدر يقرأ، الأدمن بس يكتب/يعدل/يمسح |
| **progress** | الطالب يشوف تقدمه فقط، الأدمن يشوف الكل |
| **exam_attempts** | الطالب يشوف محاولاته فقط |
| **profiles** | أي مصادق يقدر يقرأ |
| **videos bucket** | أي مصادق يقدر يقرأ (signed URLs) |
| **question-images bucket** | أي مصادق يقدر يقرأ/يرفع |

---

## 7. نظام الفيديو

- **التخزين:** Bucket خاص (مش public)، الفيديوهات بتتشغل عن طريق Signed URLs (تنتهي بعد ساعة)
- **الجودة:** الأدمن يقدر يرفع فيديو واحد أو يدخل URLs لجودات مختلفة (1080p, 720p, 480p, 360p)
- **المشغل:** Custom video player (HTML5) بدون أي مكتبات خارجية
- **streaming:** مش HLS/DASH — الفيديو بينزل كامل كـ Blob (Progressive Download)
- **المشكلة:** مفيش transcoding/compress — الفيديو بينزل بالحجم الأصلي

---

## 8. النظام الأساسي للوظائف (script.js)

### دورة الحياة
```
initApp()
  ├── sb.auth.getSession()          ← فيش لو في session
  ├── loadUserAndProgress()         ← تجيب profile + progress + exam_attempts
  ├── fetchCourses()                ← تجيب كل المحتوى (courses + lessons + questions)
  └── updateAuthUI()                ← تظهر الأزرار حسب حالة الدخول
```

### المحرك الأساسي
- **COURSES**: Array واحد فيه كل المحتوى (بيتحمل مرة واحدة في البداية)
- **Progress**: Object بالمفتاح lesson_id (بيحتوي scores + completed)
- **quizState**: Object مؤقت لإدارة حالة الامتحان الجاري
- **التخزين المؤقت**: `window._examAttempts` لكل درس، `localStorage` للـ weekly rotation

### أشهر الدوال
| الدالة | الوظيفة |
|--------|---------|
| `fetchCourses()` | تجيب كل الكورسات بالأسئلة من Supabase |
| `showView()` | تظهر صفحة وتخفي الباقي |
| `startDynamicExam()` | تبدأ امتحان ديناميكي بأسئلة عشوائية |
| `startSmartReview()` | تبدأ مراجعة ذكية بأسئلة من الدروس المكتملة |
| `submitAll()` | تصحح الإجابات وتحفظ النتيجة |
| `vpInit()` | تشغل مشغل الفيديو المخصص |
| `loadBatchQuestions()` | تجيب بيانات الأسئلة من DB بالـ IDs |
| `saveProgress()` | تحفظ التقدم لجميع الدروس |

---

## 9. ملاحظات هامة لأي AI تاني

1. **الأسماء بالعربي**: في الكود، أسماء الحقول زي `واجب` و `امتحان` و `شرح` — دي أسماء عربية لخصائص JavaScript (مش JSON).

2. **نظام Quiz**: أسئلة نصية (`exam_questions`) وجوابها index رقمي (0-3). أسئلة مصورة (`exam_image_questions`) وجوابها حرف (A/B/C/D) وبتتحول لرقم (0-3) وقت التشغيل.

3. **الامتحان الديناميكي**: كل طالب عنده pool خاص (`exam_student_pool`) بيختار منه أسئلة كل محاولة. الأسئلة اللي اتعرضت بتتوسم `seen=true`.

4. **Smart Review**: بتجيب أسئلة من دروس مكتملة، تركز على الأسئلة اللي الطالب غلط فيها (60%). في weekly rotation باستخدام localStorage.

5. **مفيش SSR/SSG**: الموقع SPA كامل — كل المحتوى بيتحمل من Supabase بعد تحميل الصفحة.

6. **التوافق**: الموقع شغال من `file://` مباشرة (مش محتاج سيرفر). الـ CORS معمول `Allow-Origin: *`.

7. **نظام التصحيح**: المقارنة `Number(ua) !== Number(q.correct)` — دايماً بتحول لرقم عشان تتجنب string vs number issues.

8. **مفتاح Supabase**:
   - URL: `https://usllnkoqqpfynsiprvqh.supabase.co`
   - Anon Key: موجود في أول سطر من `script.js`
