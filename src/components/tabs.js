import { macroConfig } from '../data/macroConfig.js';
import { candleService, TIMEFRAMES } from '../data/candleService.js';
import { calendarService } from '../data/calendarService.js';
import { createHeader } from './header.js';
import { renderTileGrid } from './tileGrid.js';
import { initCalendarView } from './calendarView.js';

const FIVE_MIN_MS = 5 * 60 * 1000;

function el(tag, className) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  return n;
}

export function initTabsApp(mountEl) {
  const state = {
    activeTabId: macroConfig.tabs[0].id, // default = Global
    timeframe: TIMEFRAMES.ONE_DAY
  };

  const app = el('div', 'app');

  const header = createHeader({
    onTimeframeChange: (tf) => {
      state.timeframe = tf;
      header.setActiveTf(tf);
      rerenderActive();
    },
    onRefresh: async () => {
      await refreshActiveTab({ force: true, reason: 'manual' });
    }
  });

  const main = el('main', 'app-main');
  const tabbar = el('nav', 'tabbar');

  const views = new Map(); // tabId -> { viewEl, kind }

  macroConfig.tabs.forEach((t) => {
    const view = el('section', 'tab-view');
    view.dataset.tab = t.id;

    if (t.kind === 'macro') {
      const grid = el('div', 'tile-grid-host');
      view.appendChild(grid);
    } else {
      const cal = el('div', 'calendar-container');
      view.appendChild(cal);
    }

    main.appendChild(view);
    views.set(t.id, { viewEl: view, kind: t.kind });
  });

  macroConfig.tabs.forEach((t) => {
    const b = el('button', 'tab-btn');
    b.type = 'button';
    b.textContent = t.shortName;
    b.dataset.tab = t.id;
    b.addEventListener('click', () => setActiveTab(t.id));
    tabbar.appendChild(b);
  });

  app.appendChild(header.el);
  app.appendChild(main);
  app.appendChild(tabbar);

  mountEl.innerHTML = '';
  mountEl.appendChild(app);

  // Calendar wiring
  let calendar = null;
  function ensureCalendarInit() {
    const entry = views.get('calendar');
    if (!entry) return;

    const container = entry.viewEl.querySelector('.calendar-container');
    if (!container) return;

    if (!calendar) {
      calendar = initCalendarView(container);
    }
  }

  function updateTabbar() {
    tabbar.querySelectorAll('.tab-btn').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.tab === state.activeTabId);
    });
  }

  function showActiveView() {
    views.forEach(({ viewEl }, tabId) => {
      viewEl.classList.toggle('is-active', tabId === state.activeTabId);
    });
  }

  function updateHeaderForActiveTab() {
    const tab = macroConfig.tabs.find((t) => t.id === state.activeTabId);
    header.setTabLongName(tab?.longName || '—');

    if (tab?.kind === 'calendar') {
      header.setTimeframeVisible(false);
      // last updated for calendar comes from calendar cache
      header.setLastUpdated(calendarService.getLastFetchMs?.() || null);
    } else {
      header.setTimeframeVisible(true);
      header.setActiveTf(state.timeframe);
      header.setLastUpdated(candleService.getTabLastUpdatedMs(state.activeTabId));
    }
  }

  function rerenderActive() {
    const tab = macroConfig.tabs.find((t) => t.id === state.activeTabId);
    if (!tab) return;

    if (tab.kind === 'macro') {
      const { viewEl } = views.get(tab.id);
      const host = viewEl.querySelector('.tile-grid-host');
      renderTileGrid(host, { tabId: tab.id, timeframe: state.timeframe });
      header.setLastUpdated(candleService.getTabLastUpdatedMs(tab.id));
    } else {
      ensureCalendarInit();
      calendar?.renderFromCache?.();
      header.setLastUpdated(calendarService.getLastFetchMs?.() || null);
    }
  }

  async function refreshActiveTab({ force = false, reason = 'auto' } = {}) {
    const tab = macroConfig.tabs.find((t) => t.id === state.activeTabId);
    if (!tab) return;

    header.setRefreshing(true);

    try {
      if (tab.kind === 'macro') {
        await candleService.prefetchTab(tab.id, { reason, force });
        header.setLastUpdated(candleService.getTabLastUpdatedMs(tab.id));
        rerenderActive();
      } else {
        ensureCalendarInit();
        await calendar?.refresh?.({ force: true });
        header.setLastUpdated(calendarService.getLastFetchMs?.() || null);
      }
    } finally {
      header.setRefreshing(false);
    }
  }

  function setActiveTab(tabId) {
    state.activeTabId = tabId;
    updateTabbar();
    showActiveView();
    updateHeaderForActiveTab();

    // Render quickly from cache
    rerenderActive();
  }

  // initial view
  setActiveTab(state.activeTabId);

  return {
    startAutoRefresh() {
      // On open: refresh active tab only (no keys required to see UI; it’ll fail gracefully)
      refreshActiveTab({ force: false, reason: 'startup' });

      const id = setInterval(() => {
        refreshActiveTab({ force: false, reason: 'timer' });
      }, FIVE_MIN_MS);

      return () => clearInterval(id);
    }
  };
}