// src/main.js
import './styles/layout.css';
import './styles/tiles.css';
import './styles/charts.css';

import { registerSW } from './pwa/registerSW.js';
import { initTabsApp } from './components/tabs.js';

// Zoom-lock (iOS Safari)
['gesturestart', 'gesturechange', 'gestureend'].forEach((evt) => {
  document.addEventListener(evt, (e) => e.preventDefault(), { passive: false });
});

let lastTouchEnd = 0;
document.addEventListener(
  'touchend',
  (e) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) e.preventDefault();
    lastTouchEnd = now;
  },
  { passive: false }
);

registerSW();

const mount = document.getElementById('app');
const app = initTabsApp(mount);

// Start refresh schedules
app.startAutoRefresh();