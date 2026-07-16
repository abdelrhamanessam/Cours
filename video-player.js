const VIDEO_API = '';

async function playEncryptedVideo(lessonId, container) {
  if (!currentUser) { alert('Please log in first.'); return; }
  const { data: { session } } = await sb.auth.getSession();
  const token = session?.access_token;
  if (!token) { alert('Session expired. Please log in again.'); return; }

  const base = VIDEO_API || '';
  const isInline = !!container;
  if (!isInline) showView('video-player');
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

    wrap.innerHTML = `
      <div class="vp-wrap">
        <video id="vp-video" controls autoplay class="vp-video" playsinline controlsList="nodownload noremoteplayback" oncontextmenu="return false" disablePictureInPicture></video>
        <div class="vp-status" id="vp-status">Downloading and decrypting...</div>
      </div>
    `;

    const status = document.getElementById('vp-status');

    const seg = manifest.segments[0];
    status.textContent = 'Downloading...';
    const resp = await fetch(`${base}/api/download?mid=${manifest.manifestId}`, { headers });
    const encrypted = await resp.arrayBuffer();

    status.textContent = 'Decrypting...';

    const iv = hexToBytes(seg.iv);
    const combined = new Uint8Array(encrypted.slice(16));

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      key, combined
    );

    status.textContent = 'Starting...';

    const video = document.getElementById('vp-video');
    const ext = (seg.file_name || '').split('.').slice(-2, -1)[0] || 'mp4';
    const mime = ext === 'webm' ? 'video/webm' : ext === 'ogg' ? 'video/ogg' : 'video/mp4';
    video.src = URL.createObjectURL(new Blob([decrypted], { type: mime }));

    // Watermark overlay
    const watermark = document.createElement('div');
    watermark.className = 'enc-watermark';
    const userEmail = currentUser?.email || 'user';
    const shortId = currentUser?.id?.slice(0, 8) || '';
    watermark.textContent = userEmail + ' | ' + shortId;
    const videoEl = container ? container.querySelector('.vp-wrap') : document.querySelector('.vp-wrap') || wrap;
    if (videoEl) {
      videoEl.appendChild(watermark);
      watermark.style.cssText = 'position:absolute;bottom:12%;right:3%;background:rgba(0,0,0,0.6);color:rgba(255,255,255,0.35);font-size:13px;padding:4px 10px;border-radius:4px;pointer-events:none;z-index:999;font-family:sans-serif;white-space:nowrap;max-width:70%;overflow:hidden;text-overflow:ellipsis;transition:opacity 0.5s';
      let watermarkTimer = setTimeout(() => { watermark.style.opacity = '0.1'; }, 10000);
      if (video) {
        video.addEventListener('pause', () => { watermark.style.opacity = '1'; clearTimeout(watermarkTimer); });
        video.addEventListener('play', () => { watermark.style.opacity = '0.1'; watermarkTimer = setTimeout(() => { watermark.style.opacity = '0.1'; }, 10000); });
        video.addEventListener('mouseenter', () => { watermark.style.opacity = '1'; });
        video.addEventListener('mouseleave', () => { if (!video.paused) { watermark.style.opacity = '0.1'; } });
      }
      function moveWatermark() {
        if (watermark.style.opacity !== '0' && watermark.style.opacity !== '0.1') return;
        const positions = [
          { bottom: '12%', right: '3%' },
          { bottom: '3%', left: '3%' },
          { top: '12%', right: '3%' },
          { top: '3%', left: '3%' },
          { bottom: '5%', right: '5%', transform: 'none' }
        ];
        const pos = positions[Math.floor(Math.random() * positions.length)];
        Object.assign(watermark.style, { top: '', left: '', bottom: '', right: '' }, pos);
      }
      setInterval(moveWatermark, 4000);
    }

    video.load();

    status.textContent = '';

  } catch (err) {
    wrap.innerHTML = `<div class="vp-error">Error: ${err.message}</div>`;
    console.error('Video player error:', err);
  }
}

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
    const manifestResp = await fetch(`${base}/api/manifest/0?mid=${manifestId}`, { headers });
    if (!manifestResp.ok) throw new Error('Video not available');
    const manifest = await manifestResp.json();

    const keyResp = await fetch(`${base}/api/key/0?mid=${manifestId}`, { headers });
    if (!keyResp.ok) throw new Error('Access denied');
    const keyData = await keyResp.arrayBuffer();
    const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['decrypt']);

    container.innerHTML = `
      <div class="vp-wrap">
        <video id="vp-video" controls autoplay class="vp-video" playsinline controlsList="nodownload noremoteplayback" oncontextmenu="return false" disablePictureInPicture></video>
        <div class="vp-status" id="vp-status">Downloading and decrypting...</div>
      </div>
    `;

    const status = document.getElementById('vp-status');

    const seg = manifest.segments[0];
    status.textContent = 'Downloading...';
    const resp = await fetch(`${base}/api/download?mid=${manifest.manifestId}`, { headers });
    const encrypted = await resp.arrayBuffer();

    status.textContent = 'Decrypting...';

    const iv = hexToBytes(seg.iv);
    const combined = new Uint8Array(encrypted.slice(16));

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      key, combined
    );

    status.textContent = 'Starting...';

    const video = document.getElementById('vp-video');
    const ext = (seg.file_name || '').split('.').slice(-2, -1)[0] || 'mp4';
    const mime = ext === 'webm' ? 'video/webm' : ext === 'ogg' ? 'video/ogg' : 'video/mp4';
    video.src = URL.createObjectURL(new Blob([decrypted], { type: mime }));

    // Watermark overlay
    const watermark = document.createElement('div');
    watermark.className = 'enc-watermark';
    const userEmail = currentUser?.email || 'user';
    const shortId = currentUser?.id?.slice(0, 8) || '';
    watermark.textContent = userEmail + ' | ' + shortId;
    const videoEl = container ? container.querySelector('.vp-wrap') : document.querySelector('.vp-wrap');
    if (videoEl) {
      videoEl.appendChild(watermark);
      watermark.style.cssText = 'position:absolute;bottom:12%;right:3%;background:rgba(0,0,0,0.6);color:rgba(255,255,255,0.35);font-size:13px;padding:4px 10px;border-radius:4px;pointer-events:none;z-index:999;font-family:sans-serif;white-space:nowrap;max-width:70%;overflow:hidden;text-overflow:ellipsis;transition:opacity 0.5s';
      let watermarkTimer = setTimeout(() => { watermark.style.opacity = '0.1'; }, 10000);
      if (video) {
        video.addEventListener('pause', () => { watermark.style.opacity = '1'; clearTimeout(watermarkTimer); });
        video.addEventListener('play', () => { watermark.style.opacity = '0.1'; watermarkTimer = setTimeout(() => { watermark.style.opacity = '0.1'; }, 10000); });
        video.addEventListener('mouseenter', () => { watermark.style.opacity = '1'; });
        video.addEventListener('mouseleave', () => { if (!video.paused) { watermark.style.opacity = '0.1'; } });
      }
      function moveWatermark() {
        if (watermark.style.opacity !== '0' && watermark.style.opacity !== '0.1') return;
        const positions = [
          { bottom: '12%', right: '3%' },
          { bottom: '3%', left: '3%' },
          { top: '12%', right: '3%' },
          { top: '3%', left: '3%' },
          { bottom: '5%', right: '5%', transform: 'none' }
        ];
        const pos = positions[Math.floor(Math.random() * positions.length)];
        Object.assign(watermark.style, { top: '', left: '', bottom: '', right: '' }, pos);
      }
      setInterval(moveWatermark, 4000);
    }

    video.load();

    status.textContent = '';

  } catch (err) {
    container.innerHTML = `<div class="vp-error">Error: ${err.message}</div>`;
    console.error('Video player error:', err);
  }
}

function hexToBytes(hex) {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) b[i >> 1] = parseInt(hex.substr(i, 2), 16);
  return b;
}
