import { macroConfig } from '../data/macroConfig.js';
import { TIMEFRAMES } from '../data/candleService.js';
import { calendarService } from '../data/calendarService.js';
import { quoteService } from '../data/quoteService.js';
import { createHeader } from './header.js';
import { createTileGrid } from './tileGrid.js';
import { createCalendarView } from './calendarView.js';

function el(tag, className) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  return n;
}

export function initTabsApp(root) {
  const state = {
    activeTabId: macroConfig.tabs[0].id,
    timeframe: TIMEFRAMES.ONE_DAY,
    header: null,
    views: new Map()
  };

  const app = el('div', 'app');
  root.appendChild(app);

  const header = createHeader({
    onRefresh: async () => {
      await refreshActiveTab({ force: true, reason: 'manual' });
    },
    onTimeframeChange: (tf) => {
      state.timeframe = tf;
      rerenderActive();
    }
  });
  state.header = header;
  app.appendChild(header.el);

  const content = el('div', 'content');
  app.appendChild(content);

  const tabbar = el('div', 'tabbar');
  app.appendChild(tabbar);

  for (const tab of macroConfig.tabs) {
    const view = el('div', 'tab-view');
    view.dataset.tabId = tab.id;
    content.appendChild(view);

    state.views.set(tab.id, { tab, viewEl: view });

    const btn = el('button', 'tabbar-btn');
    btn.textContent = tab.shortName;
    btn.addEventListener('click', () => {
      if (state.activeTabId === tab.id) return;
      state.activeTabId = tab.id;
      rerenderActive();
      refreshActiveTab({ force: false, reason: 'switch' });
    });
    tabbar.appendChild(btn);
  }

  function updateHeaderForActiveTab() {
    const tab = macroConfig.tabs.find(t => t.id === state.activeTabId);
    header.setTitle('Macro Dashboard');
    header.setSubtitle(tab.longName);
    header.setActiveTab(tab.id);

    if (tab.kind === 'calendar') {
      header.setTimeframeVisible(false);
      header.setLastUpdated(calendarService.getLastUpdatedMs());
    } else {
      header.setTimeframeVisible(true);
      header.setActiveTf(state.timeframe);
      header.setLastUpdated(quoteService.getTabLastUpdatedMs(state.activeTabId));
    }
  }

  function renderActiveView() {
    for (const { viewEl } of state.views.values()) viewEl.style.display = 'none';

    const { tab, viewEl } = state.views.get(state.activeTabId);
    viewEl.style.display = 'block';
    viewEl.innerHTML = '';

    if (tab.kind === 'calendar') {
      viewEl.appendChild(createCalendarView().el);
    } else {
      const grid = createTileGrid({
        tabId: tab.id,
        symbols: tab.symbols,
        timeframe: state.timeframe
      });
      viewEl.appendChild(grid.el);
    }
  }

  function updateTabbarActive() {
    const btns = Array.from(tabbar.querySelectorAll('.tabbar-btn'));
    for (const b of btns) {
      b.classList.toggle('active', b.textContent === macroConfig.tabs.find(t => t.id === state.activeTabId)?.shortName);
    }
  }

  function rerenderActive() {
    updateHeaderForActiveTab();
    renderActiveView();
    updateTabbarActive();
  }

  async function refreshActiveTab({ force = false }) {
    const tab = macroConfig.tabs.find(t => t.id === state.activeTabId);
    header.setRefreshing(true);

    try {
      if (tab.kind === 'calendar') {
        await calendarService.refreshIfDue({ force });
        header.setLastUpdated(calendarService.getLastUpdatedMs());
      } else {
        await quoteService.prefetchTab(tab.id, tab.symbols, { force });
        header.setLastUpdated(quoteService.getTabLastUpdatedMs(tab.id));
      }
    } catch (e) {
      console.warn('Refresh failed', e);
    } finally {
      header.setRefreshing(false);
      renderActiveView(); // re-render to show new quote cache
    }
  }

  // Initial render + load active tab data
  rerenderActive();
  refreshActiveTab({ force: false, reason: 'initial' });

  // Auto-refresh active macro tab every 5 minutes (calendar remains scheduled in calendarService)
  setInterval(() => {
    const tab = macroConfig.tabs.find(t => t.id === state.activeTabId);
    if (tab?.kind === 'macro') refreshActiveTab({ force: false, reason: 'auto' });
  }, 5 * 60 * 1000);

  return { state };
}
