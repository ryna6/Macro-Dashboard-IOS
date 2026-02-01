export function registerSW() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    try {
      // root scope
      await navigator.serviceWorker.register('/sw.js');
    } catch (e) {
      console.warn('[SW] register failed', e);
    }
  });
}