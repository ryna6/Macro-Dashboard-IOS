// src/pwa/registerSW.js
export function registerSW() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    try {
      // Root scope (critical for PWAs)
      await navigator.serviceWorker.register('/sw.js');
    } catch (e) {
      console.warn('[SW] register failed', e);
    }
  });
}
