const VIDEO_API = ''; // Leave empty for same-domain Pages Functions, or set to full URL

async function playEncryptedVideo(lessonId) {
  if (!currentUser) { alert('Please log in first.'); return; }
  const token = (await sb.auth.getSession())?.access_token;
  if (!token) { alert('Session expired. Please log in again.'); return; }

  const base = VIDEO_API || '';
  showView('video-player');
  const container = document.getElementById('video-player-container');
  container.innerHTML = '<div class="vp-loading">Loading video...</div>';

  try {
    const headers = { 'Authorization': `Bearer ${token}` };

    const manifestResp = await fetch(`${base}/api/manifest/${lessonId}`, { headers });
    if (!manifestResp.ok) { container.innerHTML = '<div class="vp-error">Video not available</div>'; return; }
    const manifest = await manifestResp.json();

    const keyResp = await fetch(`${base}/api/key/${lessonId}`, { headers });
    if (!keyResp.ok) { container.innerHTML = '<div class="vp-error">Access denied</div>'; return; }
    const keyData = await keyResp.arrayBuffer();
    const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['decrypt']);

    container.innerHTML = `
      <div class="vp-wrap">
        <video id="vp-video" controls autoplay class="vp-video" playsinline></video>
        <div class="vp-progress"><div class="vp-progress-bar" id="vp-progress-bar"></div></div>
        <div class="vp-status" id="vp-status">Decrypting segments...</div>
      </div>
    `;

    const ms = new MediaSource();
    const video = document.getElementById('vp-video');
    video.src = URL.createObjectURL(ms);

    ms.addEventListener('sourceopen', async () => {
      const sb = ms.addSourceBuffer('video/mp2t');
      const status = document.getElementById('vp-status');
      const progress = document.getElementById('vp-progress-bar');

      for (const seg of manifest.segments) {
        status.textContent = `Decrypting segment ${seg.segment_num}/${manifest.totalSegments}...`;
        progress.style.width = `${(seg.segment_num / manifest.totalSegments) * 100}%`;

        const resp = await fetch(seg.mega_link);
        const encrypted = await resp.arrayBuffer();

        const iv = hexToBytes(seg.iv);
        const combined = new Uint8Array(encrypted.slice(16));

        const decrypted = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv, tagLength: 128 },
          key,
          combined
        );

        await appendBuffer(sb, decrypted);
      }

      ms.endOfStream();
      status.textContent = 'Done';
      progress.style.width = '100%';
    });

  } catch (err) {
    container.innerHTML = `<div class="vp-error">Error: ${err.message}</div>`;
    console.error('Video player error:', err);
  }
}

function appendBuffer(sourceBuffer, data) {
  return new Promise((resolve, reject) => {
    sourceBuffer.appendBuffer(data);
    sourceBuffer.addEventListener('updateend', resolve, { once: true });
    sourceBuffer.addEventListener('error', reject, { once: true });
  });
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  return bytes;
}
