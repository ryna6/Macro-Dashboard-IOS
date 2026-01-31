// src/components/tabs.js
import { macroConfig } from '../data/macroConfig.js';
import { candleService, TIMEFRAMES } from '../data/candleService.js';
import { calendarService } from '../data/calendarService.js';
import { createHeader } from './header.js';
import { renderTileGrid } from './tileGrid.js';
import { initCalendarView } from './calendarView.js'; // assumes you renamed correctly

const FIVE_MIN_MS = 5 * 60 * 1000;

function el(tag, className) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  return n;
}

function clearKeysByPrefix(prefix) {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch (_) {}
}

export function initTabsApp(mountEl) {
  const state = {
    activeTabId: macroConfig.tabs[0].id, // default tab = Global
    timeframe: TIMEFRAMES.ONE_DAY
  };

  // Root layout
  const app = el('div', 'app');

  // Header
  const header = createHeader({
    onTimeframeChange: (tf) => {
      state.timeframe = tf;
      header.setActiveTf(tf);
      rerenderActive();
    },
    onRefreshAction: async (action) => {
      if (action === 'refresh_tab') await refreshTab(state.activeTabId, 'manual');
      if (action === 'refresh_all') await refreshAllMacroTabs('manual');
      if (action === 'clear_macro_cache') {
        clearKeysByPrefix('md_macro_candles_v1');
        clearKeysByPrefix('md_macro_forex_map_v1');
        await refreshAllMacroTabs('manual');
      }
      if (action === 'refresh_calendar') {
        await refreshCalendar(true);
      }
      if (action === 'clear_calendar_cache') {
        calendarService.resetCache();
        await refreshCalendar(true);
      }
    }
  });

  // Main view container
  const main = el('main', 'app-main');

  // Tab bar
  const tabbar = el('nav', 'tabbar');

  // Build tab views
  const views = new Map(); // tabId -> { viewEl, kind }
  macroConfig.tabs.forEach((t) => {
    const view = el('section', 'tab-view');
    view.dataset.tab = t.id;

    if (t.kind === 'macro') {
      const grid = el('div', 'tile-grid-host');
      view.appendChild(grid);
    } else {
      // calendar
      const cal = el('div', 'calendar-container');
      view.appendChild(cal);
    }

    main.appendChild(view);
    views.set(t.id, { viewEl: view, kind: t.kind });
  });

  // Build tab buttons
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

  // Render helpers
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
      header.setRefreshMenuForTab('calendar');
    } else {
      header.setTimeframeVisible(true);
      header.setRefreshMenuForTab('macro');
      header.setActiveTf(state.timeframe);
    }

    // last updated line
    if (tab?.kind === 'calendar') {
      const cached = calendarService.getWeeklyUS ? null : null; // no-op (we update below)
      // We'll update after refreshCalendar() runs
      header.setLastUpdated(null);
    } else {
      header.setLastUpdated(candleService.getTabLastUpdatedMs(state.activeTabId));
    }
  }

  function rerenderActive() {
    const tab = macroConfig.tabs.find((t) => t.id === state.activeTabId);
    if (!tab) return;

    if (tab.kind === 'macro') {
      const { viewEl } = views.get(tab.id);
      const host = viewEl.querySelector('.tile-grid-host');
      renderTileGrid(host, {
        tabId: tab.id,
        timeframe: state.timeframe
      });
      header.setLastUpdated(candleService.getTabLastUpdatedMs(tab.id));
    } else {
      // calendar rendering handled by initCalendarView / calendarService
      // (we keep header’s last updated line)
    }
  }

  function setActiveTab(tabId) {
    state.activeTabId = tabId;
    updateTabbar();
    showActiveView();
    updateHeaderForActiveTab();

    // Render macro grids on demand (instant from cache)
    const tab = macroConfig.tabs.find((t) => t.id === tabId);
    if (tab?.kind === 'macro') rerenderActive();
  }

  // Refresh logic
  async function refreshAllMacroTabs(reason = 'auto') {
    const macroTabs = macroConfig.tabs.filter((t) => t.kind === 'macro');
    await Promise.allSettled(macroTabs.map((t) => candleService.prefetchTab(t.id, { reason })));

    // Update header if we’re on a macro tab
    const activeTab = macroConfig.tabs.find((t) => t.id === state.activeTabId);
    if (activeTab?.kind === 'macro') {
      header.setLastUpdated(candleService.getTabLastUpdatedMs(state.activeTabId));
      rerenderActive();
    }
  }

  async function refreshTab(tabId, reason = 'auto') {
    const tab = macroConfig.tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== 'macro') return;
    await candleService.prefetchTab(tabId, { reason });

    if (state.activeTabId === tabId) {
      header.setLastUpdated(candleService.getTabLastUpdatedMs(tabId));
      rerenderActive();
    }
  }

  async function refreshCalendar(force = false) {
    const { lastFetchMs } = await calendarService.getWeeklyUS({ force });
    if (macroConfig.tabs.find((t) => t.id === state.activeTabId)?.kind === 'calendar') {
      header.setLastUpdated(lastFetchMs || null);
    }
  }

  // Calendar init (render list into its container; keep header as the “Last updated” source)
  (function initCalendar() {
    const { viewEl } = views.get('calendar') || {};
    if (!viewEl) return;
    // Let the calendarView render the grouped list. Disable its own “last updated” + refresh button hooks.
    initCalendarView({
      viewId: viewEl.id || undefined,
      containerSelector: '.calendar-container',
      lastUpdatedSelector: '.__nope__',
      refreshSelector: '.__nope__'
    });
  })();

  // Startup: show default tab
  setActiveTab(state.activeTabId);

  // Return API for main.js
  return {
    refreshAllMacroTabs,
    refreshCalendar,
    startAutoRefresh() {
      // immediate refresh on open
      refreshAllMacroTabs('startup');

      // 5-minute auto refresh for tabs 1–4
      const id = setInterval(() => refreshAllMacroTabs('timer'), FIVE_MIN_MS);

      // weekly calendar boundary + schedule (calendarService also checks on open)
      calendarService.scheduleWeeklyRefresh(async () => {
        await refreshCalendar(true);
      });

      return () => clearInterval(id);
    }
  };
}
