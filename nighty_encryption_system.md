# نظام تشفير الفيديوهات التعليمي — شرح كامل

## 1. لمحة عامة

منصة تعليمية (Mr Maths) بتقدم فيديوهات دروس للطلاب. الطالب بيدفع subscription عشان يشوف المحتوى. عاوزين نحمي الفيديوهات من إن أي حد يفتحها من غير ما يكون عنده صلاحية.

## 2. البنية التحتية

```
Cloudflare Pages (cours-5lc.pages.dev)
├── index.html              ← الموقع الرئيسي (SPA)
├── script.js               ← كل logic بتاع الموقع
├── video-player.js          ← مشغل الفيديو المشفر
├── admin.html              ← لوحة التحكم
├── style.css
├── _routes.json            ← توجيه API للـ Functions
└── functions/
    └── api/
        ├── manifest/[lessonId].js  ← بيجيب manifest الفيديو
        ├── key/[lessonId].js       ← بيجيب مفتاح التشفير (AES-256 key)
        └── upload.js               ← بيستقبل الفيديو المشفر ويرفعه

Supabase
├── encrypted-videos bucket         ← مخزن الملفات المشفرة
├── video_manifests table           ← بيانات المانيفست (id, master_key, course_id, lesson_id)
└── mega_segments table             ← أجزاء الفيديو (manifest_id, file_name, iv, mega_link)

Environment Variables (Cloudflare):
├── SUPABASE_URL                    ← رابط مشروع Supabase
├── SUPABASE_ANON_KEY               ← المفتاح العام (للـ auth)
└── SUPABASE_SERVICE_KEY (Secret)   ← المفتاح السري (للوصول لقاعدة البيانات)
```

## 3. تدفق رفع الفيديو (Admin)

```
الأدمن في صفحة Videos:
  1. بيختار ملف MP4 من جهازه
  2. Web Crypto API بيعمل:
     - Generate AES-256-GCM key
     - توليد IV عشوائي (16 byte)
     - encrypt(fileData, { iv, tagLength: 128 })
     - تخزين الملف كـ Blob: [IV (16 bytes) + ciphertext + authTag (16 bytes)]
  3. بيعمل POST /api/upload مع:
     - FormData: file (encrypted blob), keyHex, ivHex, originalName
  ──────────────────────────────────────────────
  Cloudflare Function (/api/upload):
    4. بيفحص الـ Authorization token (Supabase Auth)
    5. بيرفع الملف المشفر لـ Supabase Storage
    6. بيسجل في video_manifests: { id, master_key, created_at }
    7. بيسجل في mega_segments: { manifest_id, file_name, iv, mega_link }
    8. بيرجع { manifestId, fileName }
  ──────────────────────────────────────────────
  Supabase:
    - الملف في encrypted-videos/public/ (مشفر)
    - الـ manifest في video_manifests
    - الـ segment في mega_segments
```

## 4. تدفق تشغيل الفيديو (Student)

```
الطالب بيفتح lecture وفيها video_url = "encrypted:MANIFEST_ID"

renderContentPage() في script.js:
  1. بتشوف إن video_url يبدأ بـ "encrypted:"
  2. بتنشئ <div id="enc-video-container">
  3. بتستدعي playEncryptedVideoById(manifestId, container)

video-player.js:
  4. بتجيب session token من Supabase Auth
  5. بتطلب GET /api/manifest/0?mid=MANIFEST_ID
     ← Cloudflare Function بتجيب الـ manifest من Supabase
     ← بترجع: { manifestId, totalSegments, segments: [{mega_link, iv, file_name}] }
  6. بتطلب GET /api/key/0?mid=MANIFEST_ID
     ← Cloudflare Function بتجيب master_key من Supabase
     ← بترجع: binary (32 bytes - raw AES-256 key)
  7. بتستورد الـ key: crypto.subtle.importKey('raw', keyData, 'AES-GCM', false, ['decrypt'])
  8. بتطلب الملف المشفر من mega_link (Supabase Storage public URL)
  9. بتستخرج IV من seg.iv (hex → bytes)
  10. بتعمل slice(16) للملف عشان تشيل أول 16 byte (الـ IV المخزن)
  11. بتفك التشفير: crypto.subtle.decrypt({ iv, tagLength: 128 }, key, combined)
  12. بتعمل blob URL: URL.createObjectURL(new Blob([decrypted], { type: 'video/mp4' }))
  13. بتدخل الـ blob URL في <video> element
```

## 5. طبقات الحماية

### ✅ بنحمي من:

| التهديد | آلية المنع |
|---------|-----------|
| حد معاه رابط Supabase Storage المباشر يفتح الفيديو | الملف مشفر، مش هيقدر يقراه من غير الـ key |
| حد عنده manifest ID (من inspect element مثلًا) | محتاج الـ key، والـ key مش بيتصرف غير بعد Auth |
| حد مش مسجل يدخل على `/api/manifest/...` | الـ API بتعمل verify للـ token الأول |
| حد مش مسجل يدخل على `/api/key/...` | نفس الكلام |
| طالب يشارك رابط الفيديو مع حد تاني | التاني هيكون عنده الملف المشفر بس، بدون key صالح |
| اعتراض حركة المرور (MITM) | HTTPS + الملف مشفر أصلاً |
| اختراق قاعدة البيانات وجلب الـ keys | مشكلة، بس الـ service key مش موجود في العميل |

### ❌ مش بنحمي من:

| التهديد | ليه؟ |
|---------|------|
| الطالب يـ Save As من على الـ `<video>` | لأن الـ blob URL فيه الفيديو المفكوك تشفيره في ذاكرة المتصفح |
| الطالب يصور الشاشة (OBS, Snipping Tool) | ده مستحيل نمنعه في أي نظام (حتى Netflix) |
| الطالب يستخدم Browser Extension لتحميل الفيديو | الإضافات تقدر تمسك media stream |
| الطالب يستخدم DevTools عشان يطلع على الـ blob URL | الـ blob URL موجودة في المتصفح وأي حد يقدر يشوفها |
| طالب يشارك الـ key مع ناس تانية | الـ key بيتصرف للـ session بتاعته، يقدر يبعته لأي حد |

## 6. الأسئلة اللي محتاجة إجابات

- هل نحتاج أنظمة DRM متقدمة (زي Widevine أو PlayReady)؟ دي محتاجة فلوس وتكامل معقد.
- هل ممكن نستخدم Adaptive Bitrate Streaming (HLS/DASH) مع التشفير عشان نخلي استخراج الفيديو أصعب؟
- هل نقدر نعمل Session Binding للـ key (يرتبط بجهاز معين أو session معينة عشان لو اتحط في موقع تاني ما يشتغلش)؟
- هل نضيف Watermarking (شفاف أو مسموع) عشان نقدر نتعقب الـ leaks؟
- هل نقدر نستخدم Service Workers عشان نمنع الـ fetch على الـ blob URL؟

## 7. نقاط ضعف محددة في النظام الحالي

1. **الـ key بيتصرف كامل لكل session** — لو طالب أخد الـ key في أول session، يقدر يستخدمه في أي وقت تاني
2. **الملف المشفر كله في blob URL واحد** — بدل ما يكون مقسم لقطع صغيرة
3. **مفيش expiry للـ manifest** — الـ manifest ID شغال دايماً
4. **مفيش rate limiting على `/api/key/...`** — يقدر يعملها无数次 ويحاول
5. **الـ service key بيستخدم مباشرة في Cloudflare Functions** — أفضل نستخدم JWT مخصصة للـ functions
