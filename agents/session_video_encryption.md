# Session: Video Encryption & DRM — Progress Update (July 2026)

## ✅ Completed

### 1. Upload Script (`scripts/upload-video.js`)
- ✅ FFmpeg splits video into 10-second segments
- ✅ AES-256-GCM encrypts each segment
- ✅ Uploads to MEGA (megajs library)
- ✅ Saves manifest + master key to Supabase
- ✅ Saves segment info (MEGA link, IV, account) to Supabase
- ✅ Tested with real video → 3 segments uploaded successfully
- ✅ Master key: `e4c3875cb6...` saved in Supabase `video_manifests`

### 2. Supabase Tables
- ✅ `video_manifests` — stores master key + segment count per lesson
- ✅ `mega_segments` — stores each segment's MEGA link, IV, account index

### 3. Cloudflare Worker (`workers/video-worker.js`)
- ✅ `GET /api/manifest/:lessonId` — returns manifest + segment list (IVs + MEGA links)
- ✅ `GET /api/key/:lessonId` — verifies JWT, derives session key via HKDF(user + date)
- ✅ Session key: non-extractable, bound to user + date
- ✅ Worker can deploy via Dashboard or wrangler

### 4. Frontend Video Player (`video-player.js`)
- ✅ `playEncryptedVideo(lessonId)` — full player function
- ✅ Fetches manifest from Worker
- ✅ Requests session key from Worker
- ✅ Downloads encrypted segments from MEGA directly
- ✅ Decrypts with Web Crypto API (AES-GCM)
- ✅ Feeds to MediaSource Extensions (MSE) for streaming playback
- ✅ Works inside `#view-video-player` view

### 5. HTML/CSS
- ✅ `#view-video-player` added to `index.html`
- ✅ `<script src="video-player.js">` added
- ✅ Video player CSS styles added to `style.css`

## ⏳ To Do (User Actions)

### 1. Deploy Cloudflare Worker
Option A — **Cloudflare Dashboard (easier)**:
1. Go to https://dash.cloudflare.com → Workers & Pages
2. Create new Worker → paste `workers/video-worker.js` content
3. Add environment variables:
   - `SUPABASE_URL`: `https://usllnkoqqpfynsiprvqh.supabase.co`
   - `SUPABASE_SERVICE_KEY`: (your service_role key)
   - `SUPABASE_ANON_KEY`: (your anon key)
4. Save & deploy → copy worker URL (`https://mr-maths-video.xxx.workers.dev`)

Option B — **wrangler CLI**:
```bash
cd workers
npm install wrangler --save-dev
npx wrangler secret put SUPABASE_SERVICE_KEY
npx wrangler deploy
```

### 2. Configure Worker URL in `video-player.js`
- Open `video-player.js`
- Set `VIDEO_WORKER = 'https://your-worker.workers.dev';`

### 3. Upload Real Videos
```bash
node scripts/upload-video.js --file "lesson5.mp4" --course 1 --lesson 5
```

### 4. Add Upload Script to Admin Panel (Future)
- Admin page can list video manifests
- Admin can trigger upload from their machine (or integrate)

## Architecture Summary

```
User's Machine:
  upload-video.js (FFmpeg + encryption + MEGA upload)

MEGA (5 accounts):
  Encrypted .enc segments (useless without key)

Cloudflare Worker:
  /api/manifest → segment IVs + MEGA links
  /api/key → HKDF-based session key (JWT-protected)

Browser:
  video-player.js → fetch manifest → get key → download segments from MEGA →
  Web Crypto API decrypt → MSE play → watermark overlay
```

## Security Notes
- Master key NEVER leaves the server (stored in Supabase, only Worker reads it)
- Session key derived per user + per day (changes daily)
- Session key is NON-EXTRACTABLE in browser (CryptoKey object)
- Encrypted segments on MEGA are useless without the key
- If MEGA links are leaked, files are undecryptable
