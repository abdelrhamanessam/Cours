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
    const resp = await fetch(seg.mega_link + '?t=' + Date.now());
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
    const resp = await fetch(seg.mega_link + '?t=' + Date.now());
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
