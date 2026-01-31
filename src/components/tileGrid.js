// src/components/tileGrid.js
import { macroConfig } from '../data/macroConfig.js';
import { candleService } from '../data/candleService.js';
import { createTile } from './tile.js';

export function renderTileGrid(container, { tabId, timeframe }) {
  if (!container) return;

  const tab = macroConfig.tabs.find((t) => t.id === tabId);
  if (!tab) return;

  container.innerHTML = '';
  container.classList.add('tile-grid');

  const specs = tab.symbols || [];
  specs.forEach((spec) => {
    const tile = createTile({
      tabId,
      symbolSpec: spec,
      timeframe
    });
    container.appendChild(tile.el);
  });
}
