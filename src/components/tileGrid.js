import { macroConfig } from '../data/macroConfig.js';
import { createTile } from './tile.js';

function parsePx(v) {
  if (!v) return 0;
  const n = parseFloat(String(v).replace('px', ''));
  return Number.isFinite(n) ? n : 0;
}

function setTileHeightCSSVar(gridEl, tileCount) {
  if (!gridEl || !tileCount) return;

  // The grid element fills .tile-grid-host (flex: 1), so its own height is the usable space.
  const rect = gridEl.getBoundingClientRect();
  const hostH = rect.height || 0;
  if (hostH <= 0) return;

  const cols = 2;
  const rows = Math.ceil(tileCount / cols);

  const cs = getComputedStyle(gridEl);
  const rowGap = parsePx(cs.rowGap || cs.gap) || 0;

  const totalGaps = rowGap * Math.max(0, rows - 1);
  const available = hostH - totalGaps;
  if (available <= 0) return;

  const target = 178; // "slightly larger fixed tiles" target
  const maxAllowed = available / rows;

  // Clamp to keep things consistent, but never exceed what fits.
  const tileH = Math.floor(Math.max(150, Math.min(target, maxAllowed, 190)));

  gridEl.style.setProperty('--tile-h', `${tileH}px`);
}

export function renderTileGrid(container, { tabId, timeframe }) {
  if (!container) return;

  const tab = macroConfig.tabs.find((t) => t.id === tabId);
  if (!tab) return;

  container.innerHTML = '';
  container.classList.add('tile-grid');

  const symbols = tab.symbols || [];
  setTileHeightCSSVar(container, symbols.length);

  symbols.forEach((spec) => {
    const tile = createTile({ tabId, symbolSpec: spec, timeframe });
    container.appendChild(tile.el);
  });
}
