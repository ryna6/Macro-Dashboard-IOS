import { createTile } from './tile.js';

function el(tag, className) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  return n;
}

/**
 * Preferred API (newer):
 * returns { el, updateAll, setTimeframe }
 */
export function createTileGrid({ tabId, symbols, timeframe }) {
  const grid = el('div', 'tile-grid');
  const tiles = [];

  (symbols || []).forEach((symbolSpec) => {
    const t = createTile({ tabId, symbolSpec, timeframe });
    tiles.push(t);
    grid.appendChild(t.el);
  });

  function setTimeframe(nextTf) {
    tiles.forEach((t) => t.setTimeframe?.(nextTf));
  }

  function updateAll() {
    tiles.forEach((t) => t.update?.());
  }

  return { el: grid, setTimeframe, updateAll };
}

/**
 * Backward-compatible API (older code):
 * renderTileGrid(container, { tabId, timeframe, symbols })
 */
export function renderTileGrid(container, { tabId, symbols, timeframe }) {
  if (!container) return;
  const grid = createTileGrid({ tabId, symbols, timeframe });
  container.innerHTML = '';
  container.appendChild(grid.el);
  return grid;
}
