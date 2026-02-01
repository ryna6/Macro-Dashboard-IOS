import { macroConfig } from '../data/macroConfig.js';
import { TIMEFRAMES } from '../data/candleService.js';
import { calendarService } from '../data/calendarService.js';
import { quoteService } from '../data/quoteService.js';
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

  // Prevent "tab switch while fetching" from leaving a new tab blank:
  // - only one refresh runs at a time
  // - if the active tab changes mid-refresh, we queue a single follow-up refresh
  let refreshing = false;
  let queuedRefresh = null; // { force, reason }

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
      header.setLastUpdated(calendarService.getLastFetchMs?.() || null);
    } else {
      header.setTimeframeVisible(true);
      header.setActiveTf(state.timeframe);
      header.setLastUpdated(quoteService.getTabLastUpdatedMs(state.activeTabId));
    }
  }

  function rerenderActive() {
    const tab = macroConfig.tabs.find((t) => t.id === state.activeTabId);
    if (!tab) return;

    if (tab.kind === 'macro') {
      const { viewEl } = views.get(tab.id);
      const host = viewEl.querySelector('.tile-grid-host');
      renderTileGrid(host, { tabId: tab.id, timeframe: state.timeframe });
      header.setLastUpdated(quoteService.getTabLastUpdatedMs(tab.id));
    } else {
      ensureCalendarInit();
      calendar?.renderFromCache?.();
      header.setLastUpdated(calendarService.getLastFetchMs?.() || null);
    }
  }

  async function refreshActiveTab({ force = false, reason = 'auto' } = {}) {
    const requestedTabId = state.activeTabId;
    if (refreshing) {
      queuedRefresh = { force, reason };
      return;
    }

    const tab = macroConfig.tabs.find((t) => t.id === requestedTabId);
    if (!tab) return;

    refreshing = true;
    header.setRefreshing(true);

    try {
      if (tab.kind === 'macro') {
        await quoteService.prefetchTab(tab.id, tab.symbols, { reason, force });
        if (state.activeTabId === tab.id) {
          header.setLastUpdated(quoteService.getTabLastUpdatedMs(tab.id));
          rerenderActive();
        }
      } else {
        ensureCalendarInit();
        await calendar?.refresh?.({ force: true });
        header.setLastUpdated(calendarService.getLastFetchMs?.() || null);
      }
    } finally {
      header.setRefreshing(false);
      refreshing = false;

      // If the user switched tabs while we were fetching, run one follow-up refresh
      // for the CURRENT active tab.
      if (queuedRefresh) {
        const next = queuedRefresh;
        queuedRefresh = null;
        if (state.activeTabId !== requestedTabId) {
          refreshActiveTab(next);
        }
      }
    }
  }

  function setActiveTab(tabId) {
    state.activeTabId = tabId;
    updateTabbar();
    showActiveView();
    updateHeaderForActiveTab();
    rerenderActive();

    // Auto-refresh the tab on first open / when stale, so switching tabs isn't blank.
    const tab = macroConfig.tabs.find((t) => t.id === tabId);
    if (tab?.kind === 'macro') {
      const last = quoteService.getTabLastUpdatedMs(tabId);
      const STALE_ON_ACTIVATE_MS = 30 * 1000;
      if (!last || (Date.now() - last) > STALE_ON_ACTIVATE_MS) {
        refreshActiveTab({ force: false, reason: 'tab-activate' });
      }
    }
  }

  // initial view
  setActiveTab(state.activeTabId);

  return {
    startAutoRefresh() {
      refreshActiveTab({ force: false, reason: 'startup' });

      const id = setInterval(() => {
        refreshActiveTab({ force: false, reason: 'timer' });
      }, FIVE_MIN_MS);

      return () => clearInterval(id);
    }
  };
}
