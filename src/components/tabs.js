import { macroConfig } from '../data/macroConfig.js';
import { TIMEFRAMES } from '../data/candleService.js';
import { calendarService } from '../data/calendarService.js';
import { quoteService } from '../data/quoteService.js';
import { intradayService } from '../data/intradayService.js';
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
    activeTabId: macroConfig.tabs[0].id,
    timeframe: TIMEFRAMES.ONE_DAY
  };

  const app = el('div', 'app');

  let refreshing = false;
  let queuedRefresh = null;

  const header = createHeader({
    onTimeframeChange: (tf) => {
      state.timeframe = tf;
      header.setActiveTf(tf);

      rerenderActive();

      const tab = macroConfig.tabs.find((t) => t.id === state.activeTabId);
      if (tab?.kind === 'macro' && tf !== TIMEFRAMES.ONE_DAY) {
        quoteService
          .ensureRangeBaselines(tab.id, tab.symbols, { force: false })
          .then((ok) => {
            const enabled = quoteService.isTimeframeEnabled(tab.id, TIMEFRAMES.ONE_WEEK);
            header.setTimeframeOptionEnabled(TIMEFRAMES.ONE_WEEK, enabled);
            header.setTimeframeOptionEnabled(TIMEFRAMES.ONE_MONTH, enabled);

            if (!ok && state.timeframe !== TIMEFRAMES.ONE_DAY) {
              state.timeframe = TIMEFRAMES.ONE_DAY;
              header.setActiveTf(state.timeframe);
            }

            rerenderActive();
          })
          .catch(() => {});
      }
    },
    onRefresh: async () => {
      await refreshActiveTab({ force: true, reason: 'manual' });
    }
  });

  const main = el('main', 'app-main');
  const tabbar = el('nav', 'tabbar');
  const views = new Map();

  macroConfig.tabs.forEach((t) => {
    const view = el('section', 'tab-view');
    view.dataset.tab = t.id;
    view.classList.add(t.kind === 'macro' ? 'tab-view--macro' : 'tab-view--calendar');

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
    if (!calendar) calendar = initCalendarView(container);
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

  function applyTimeframeAvailability(tabId) {
    const canWeek = quoteService.isTimeframeEnabled(tabId, TIMEFRAMES.ONE_WEEK);
    const canMonth = quoteService.isTimeframeEnabled(tabId, TIMEFRAMES.ONE_MONTH);

    header.setTimeframeOptionEnabled(TIMEFRAMES.ONE_WEEK, canWeek);
    header.setTimeframeOptionEnabled(TIMEFRAMES.ONE_MONTH, canMonth);

    if (state.timeframe === TIMEFRAMES.ONE_WEEK && !canWeek) {
      state.timeframe = TIMEFRAMES.ONE_DAY;
      header.setActiveTf(state.timeframe);
    }
    if (state.timeframe === TIMEFRAMES.ONE_MONTH && !canMonth) {
      state.timeframe = TIMEFRAMES.ONE_DAY;
      header.setActiveTf(state.timeframe);
    }
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
      applyTimeframeAvailability(tab.id);
      header.setLastUpdated(quoteService.getTabLastUpdatedMs(tab.id));
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
    const tabId = state.activeTabId;

    if (refreshing) {
      queuedRefresh = { force, reason };
      return;
    }

    const tab = macroConfig.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    refreshing = true;
    header.setRefreshing(true);

    try {
      if (tab.kind === 'macro') {
        // 1) Quotes (price + %)
        await quoteService.prefetchTab(tab.id, tab.symbols, { force });

        // 2) ✅ Intraday sparkline data (TwelveData time_series) for ACTIVE TAB ONLY
        //    Populate cache used by quoteService.getSnapshot() sparkline mapping.
        const tasks = (tab.symbols || []).map((s) =>
          intradayService.fetch(tab.id, s.symbol, '1D', { force }).catch(() => null)
        );
        await Promise.allSettled(tasks);

        // 3) Update UI
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

      if (queuedRefresh) {
        const next = queuedRefresh;
        queuedRefresh = null;
        refreshActiveTab(next);
      }
    }
  }

  async function refreshAllTabs({ force = true, reason = 'startup' } = {}) {
    // Active tab = loud refresh (also pulls intraday)
    await refreshActiveTab({ force, reason });

    const active = state.activeTabId;

    // Other tabs: quotes only (no intraday) to avoid TwelveData credit spikes
    for (const tab of macroConfig.tabs) {
      if (tab.id === active) continue;
      try {
        if (tab.kind === 'macro') {
          await quoteService.prefetchTab(tab.id, tab.symbols, { force });
        } else {
          ensureCalendarInit();
          await calendar?.refresh?.({ force: true });
        }
      } catch {
        // ignore per-tab failures
      }
    }
  }

  function setActiveTab(tabId) {
    state.activeTabId = tabId;
    updateTabbar();
    showActiveView();
    updateHeaderForActiveTab();
    rerenderActive();
    // ✅ no refresh on tab switch
  }

  // initial view
  setActiveTab(state.activeTabId);

  return {
    startAutoRefresh() {
      let intervalId = null;
      let disposed = false;

      const stopInterval = () => {
        if (intervalId) clearInterval(intervalId);
        intervalId = null;
      };

      const startInterval = () => {
        if (intervalId) return;
        intervalId = setInterval(() => {
          if (document.visibilityState !== 'visible') return;
          refreshActiveTab({ force: false, reason: 'timer' });
        }, FIVE_MIN_MS);
      };

      const onVisibility = () => {
        if (document.visibilityState === 'visible') {
          startInterval();
          refreshActiveTab({ force: false, reason: 'resume' });
        } else {
          stopInterval();
        }
      };

      document.addEventListener('visibilitychange', onVisibility);

      refreshAllTabs({ force: true, reason: 'startup' }).finally(() => {
        if (disposed) return;
        if (document.visibilityState === 'visible') startInterval();
      });

      if (document.visibilityState !== 'visible') stopInterval();

      return () => {
        disposed = true;
        stopInterval();
        document.removeEventListener('visibilitychange', onVisibility);
      };
    }
  };
}
