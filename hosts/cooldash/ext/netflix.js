// Docs: docs/06 - API/Netflix Provider.md
// Purpose: on Netflix's own pages: Back returns to Dholphin, sign-in returns by itself, and the position is noted.
// It reads only the video's time. It changes nothing on the page and touches no stream.
(() => {
  const BACK = new Set(['Escape', 'GoBack', 'BrowserBack', 'XF86Back']);
  const back = () => chrome.runtime.sendMessage({ t: 'back' });
  window.addEventListener('keydown', (e) => {
    if (!BACK.has(e.key)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    back();
  }, true);
  // After signing in, Netflix goes to /browse: the only thing asked of it was the sign-in.
  chrome.storage.local.get('external').then(({ external }) => {
    if (external?.intent === 'login' && /^\/([a-z-]+\/)?browse/.test(location.pathname)) back();
  });
  setInterval(() => {
    const v = document.querySelector('video');
    if (v && v.duration > 0) chrome.runtime.sendMessage({ t: 'progress', positionSec: v.currentTime, durationSec: v.duration });
  }, 10000);
})();
