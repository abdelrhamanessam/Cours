const VIDEO_API = '';
const MSE_CODECS = 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';
function esc(s) { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/`/g,'&#96;'); }

// ── Main entry: play by lessonId ─────────────────────
async function playEncryptedVideo(lessonId, container) {
  if (!currentUser) { alert('Please log in first.'); return; }
  const { data: { session } } = await sb.auth.getSession();
  const token = session?.access_token;
  if (!token) { alert('Session expired. Please log in again.'); return; }

  const base = VIDEO_API || '';
  const wrap = container || document.getElementById('video-player-container');
  if (!wrap) return;
  wrap.innerHTML = '<div class="vp-loading">Loading video...</div>';

  try {
    const headers = { 'Authorization': `Bearer ${token}` };
    const manifestResp = await fetch(`${base}/api/manifest/${lessonId}`, { headers });
    if (!manifestResp.ok) throw new Error('Video not available');
    const manifest = await manifestResp.json();

    const keyResp = await fetch(`${base}/api/key/${lessonId}`, { headers });
    if (!keyResp.ok) throw new Error('Access denied');
    const keyData = await keyResp.arrayBuffer();
    const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['decrypt']);

    buildPlayerUI(wrap, manifest, key, token, base, null);
  } catch (err) {
    wrap.innerHTML = `<div class="vp-error">Error: ${esc(err.message)}</div>`;
    console.error('Video player error:', err);
  }
}

// ── Main entry: play by manifestId (ticket or direct) ─
async function playEncryptedVideoById(manifestId, container) {
  if (!currentUser) { alert('Please log in first.'); return; }
  const { data: { session } } = await sb.auth.getSession();
  const token = session?.access_token;
  if (!token) { alert('Session expired. Please log in again.'); return; }

  const base = VIDEO_API || '';
  if (!container) return;
  container.innerHTML = '<div class="vp-loading">Loading video...</div>';

  try {
    const headers = { 'Authorization': `Bearer ${token}` };
    const isTicket = manifestId.length > 50;

    const manifestResp = await fetch(
      `${base}/api/manifest/0?${isTicket ? 'ticket=' : 'mid='}${encodeURIComponent(manifestId)}`,
      { headers }
    );
    if (!manifestResp.ok) throw new Error('Video not available');
    const manifest = await manifestResp.json();

    let keyParam = '';
    if (isTicket) {
      const atResp = await fetch(`${base}/api/access-token`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket: manifestId }),
      });
      if (!atResp.ok) throw new Error('Access denied');
      const atData = await atResp.json();
      keyParam = 'access_token=' + encodeURIComponent(atData.accessToken);
    } else {
      keyParam = 'mid=' + manifestId;
    }

    const keyResp = await fetch(`${base}/api/key/0?${keyParam}`, { headers });
    if (!keyResp.ok) throw new Error('Access denied');
    const keyData = await keyResp.arrayBuffer();
    const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['decrypt']);

    buildPlayerUI(container, manifest, key, token, base, isTicket ? manifestId : null);
  } catch (err) {
    container.innerHTML = `<div class="vp-error">Error: ${esc(err.message)}</div>`;
    console.error('Video player error:', err);
  }
}

// ── Build player UI and start streaming ──────────────
function buildPlayerUI(wrap, manifest, key, token, base, ticket) {
  const totalSegments = manifest.segments.length;
  let refreshTimer = null;

  wrap.innerHTML = `
    <div class="vp-wrap">
      <video id="vp-video" controls autoplay class="vp-video" playsinline
             controlsList="nodownload noremoteplayback"
             oncontextmenu="return false" disablePictureInPicture></video>
      <div class="vp-status" id="vp-status">Starting...</div>
    </div>
  `;

  const video = document.getElementById('vp-video');
  const status = document.getElementById('vp-status');

  // Try MSE first, fall back to Blob
  if (window.MediaSource && MediaSource.isTypeSupported(MSE_CODECS)) {
    status.textContent = 'Streaming video...';
    streamWithMSE(video, status, manifest, key, token, base)
      .then(() => {
        setupWatermark(wrap, video);
        if (ticket) refreshTimer = startTokenRefresh(token, base, ticket);
      })
      .catch((err) => {
        console.warn('MSE failed, falling back to Blob:', err);
        streamWithBlob(video, status, manifest, key, token, base)
          .then(() => {
            setupWatermark(wrap, video);
            if (ticket) refreshTimer = startTokenRefresh(token, base, ticket);
          })
          .catch((e2) => {
            status.textContent = 'Error: ' + e2.message;
          });
      });
  } else {
    streamWithBlob(video, status, manifest, key, token, base)
      .then(() => {
        setupWatermark(wrap, video);
        if (ticket) refreshTimer = startTokenRefresh(token, base, ticket);
      })
      .catch((err) => {
        status.textContent = 'Error: ' + err.message;
      });
  }

  video.load();
}

// ── MSE streaming ────────────────────────────────────
async function streamWithMSE(video, status, manifest, key, token, base) {
  const mediaSource = new MediaSource();
  video.src = URL.createObjectURL(mediaSource);

  return new Promise((resolve, reject) => {
    let aborted = false;

    mediaSource.addEventListener('sourceopen', async () => {
      if (aborted) return;

      let sourceBuffer;
      try {
        sourceBuffer = mediaSource.addSourceBuffer(MSE_CODECS);
      } catch (e) {
        reject(new Error('SourceBuffer creation failed: ' + e.message));
        return;
      }

      const appendBuffer = (data) => new Promise((res, rej) => {
        try {
          sourceBuffer.addEventListener('updateend', res, { once: true });
          sourceBuffer.appendBuffer(data);
        } catch (e) {
          rej(e);
        }
      });

      const headers = { 'Authorization': `Bearer ${token}` };

      for (let i = 0; i < manifest.segments.length; i++) {
        if (aborted) return;
        const seg = manifest.segments[i];
        status.textContent = `Downloading segment ${i + 1}/${manifest.segments.length}...`;

        try {
          const resp = await fetch(
            `${base}/api/download?mid=${manifest.manifestId}&segment=${seg.segment_num}`,
            { headers }
          );
          if (!resp.ok) throw new Error('Download failed: ' + resp.status);
          const encrypted = await resp.arrayBuffer();

          status.textContent = `Decrypting segment ${i + 1}/${manifest.segments.length}...`;
          const iv = hexToBytes(seg.iv);
          const combined = new Uint8Array(encrypted.slice(16));
          const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv, tagLength: 128 }, key, combined
          );

          status.textContent = `Buffering segment ${i + 1}/${manifest.segments.length}...`;
          await appendBuffer(decrypted);
        } catch (e) {
          if (!aborted) {
            aborted = true;
            reject(e);
          }
          return;
        }
      }

      if (!aborted) {
        mediaSource.endOfStream();
        status.textContent = '';
        resolve();
      }
    });

    mediaSource.addEventListener('sourceclose', () => {
      aborted = true;
    });

    mediaSource.addEventListener('sourceended', () => {
      status.textContent = '';
    });
  });
}

// ── Legacy Blob fallback (same as before) ────────────
async function streamWithBlob(video, status, manifest, key, token, base) {
  const headers = { 'Authorization': `Bearer ${token}` };
  const decryptedChunks = [];

  for (let i = 0; i < manifest.segments.length; i++) {
    const seg = manifest.segments[i];
    status.textContent = `Downloading segment ${i + 1}/${manifest.segments.length}...`;

    const resp = await fetch(
      `${base}/api/download?mid=${manifest.manifestId}&segment=${seg.segment_num}`,
      { headers }
    );
    if (!resp.ok) throw new Error('Download failed: ' + resp.status);
    const encrypted = await resp.arrayBuffer();

    status.textContent = `Decrypting segment ${i + 1}/${manifest.segments.length}...`;
    const iv = hexToBytes(seg.iv);
    const combined = new Uint8Array(encrypted.slice(16));
    const chunk = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: 128 }, key, combined
    );
    decryptedChunks.push(chunk);
  }

  status.textContent = 'Starting...';
  const totalLength = decryptedChunks.reduce((acc, c) => acc + c.byteLength, 0);
  const allData = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of decryptedChunks) {
    allData.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }

  video.src = URL.createObjectURL(new Blob([allData], { type: 'video/mp4' }));
  status.textContent = '';
}

// ── Watermark overlay (kept from original) ───────────
function setupWatermark(wrap, video) {
  const watermark = document.createElement('div');
  watermark.className = 'enc-watermark';
  const userEmail = currentUser?.email || 'user';
  const shortId = currentUser?.id?.slice(0, 8) || '';
  watermark.textContent = userEmail + ' | ' + shortId;

  const videoEl = wrap.querySelector('.vp-wrap') || wrap;
  if (!videoEl) return;

  videoEl.appendChild(watermark);
  watermark.style.cssText = [
    'position:absolute', 'bottom:12%', 'right:3%',
    'background:rgba(0,0,0,0.6)', 'color:rgba(255,255,255,0.35)',
    'font-size:13px', 'padding:4px 10px', 'border-radius:4px',
    'pointer-events:none', 'z-index:999', 'font-family:sans-serif',
    'white-space:nowrap', 'max-width:70%', 'overflow:hidden',
    'text-overflow:ellipsis', 'transition:opacity 0.5s',
  ].join(';');

  let watermarkTimer = setTimeout(() => { watermark.style.opacity = '0.1'; }, 10000);

  if (video) {
    video.addEventListener('pause', () => {
      watermark.style.opacity = '1';
      clearTimeout(watermarkTimer);
    });
    video.addEventListener('play', () => {
      watermark.style.opacity = '0.1';
      watermarkTimer = setTimeout(() => { watermark.style.opacity = '0.1'; }, 10000);
    });
    video.addEventListener('mouseenter', () => { watermark.style.opacity = '1'; });
    video.addEventListener('mouseleave', () => {
      if (!video.paused) watermark.style.opacity = '0.1';
    });
  }

  const positions = [
    { bottom: '12%', right: '3%' },
    { bottom: '3%', left: '3%' },
    { top: '12%', right: '3%' },
    { top: '3%', left: '3%' },
    { bottom: '5%', right: '5%' },
  ];

  setInterval(() => {
    if (watermark.style.opacity === '0' || watermark.style.opacity === '0.1') {
      const pos = positions[Math.floor(Math.random() * positions.length)];
      Object.assign(watermark.style, { top: '', left: '', bottom: '', right: '' }, pos);
    }
  }, 4000);
}

// ── Token refresh for ticket-based access ────────────
function startTokenRefresh(token, base, ticket) {
  return setInterval(async () => {
    try {
      await fetch(`${base}/api/access-token`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ticket }),
      });
    } catch {
      // silent
    }
  }, 180000);
}

// ── Utility ──────────────────────────────────────────
function hexToBytes(hex) {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    b[i >> 1] = parseInt(hex.substr(i, 2), 16);
  }
  return b;
}
