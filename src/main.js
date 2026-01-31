import { macroConfig } from './data/macroConfig.js';
import { candleService } from './data/candleService.js';

const FIVE_MIN_MS = 5 * 60 * 1000;

async function refreshAllMacroTabs(reason = 'auto') {
  // Refresh tabs 1–4 even if user never visits them
  const macroTabs = macroConfig.tabs.filter((t) => t.kind === 'macro');

  await Promise.allSettled(
    macroTabs.map((tab) => candleService.prefetchTab(tab.id, { reason }))
  );

  // Your UI can now re-render tiles for any tab instantly.
  // Example (pseudo):
  // macroTabs.forEach(tab => renderTiles(tab.id));
}

refreshAllMacroTabs('startup');
setInterval(() => refreshAllMacroTabs('timer'), FIVE_MIN_MS);
