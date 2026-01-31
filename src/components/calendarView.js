// src/components/calendarView.js
import { calendarService } from '../data/calendarService.js';
import { nyTime } from '../data/time.js';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

function stars(n) {
  if (n >= 3) return '★★★';
  if (n === 2) return '★★';
  return '★';
}

function renderLastUpdated(el, lastFetchMs, error) {
  if (!el) return;
  if (!lastFetchMs) {
    el.textContent = error ? `Last updated — (${error})` : 'Last updated —';
    return;
  }
  const tSec = Math.floor(lastFetchMs / 1000);
  el.textContent = error
    ? `Last updated ${nyTime.formatTime(tSec)} ET (${error})`
    : `Last updated ${nyTime.formatTime(tSec)} ET`;
}

function renderCalendar(container, grouped) {
  if (!container) return;
  container.innerHTML = '';

  DAYS.forEach((day) => {
    const section = document.createElement('section');
    section.className = 'cal-day-section';

    const h = document.createElement('div');
    h.className = 'cal-day-header';
    h.textContent = day;
    section.appendChild(h);

    const list = document.createElement('div');
    list.className = 'cal-day-list';

    const items = grouped?.[day] || [];
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'cal-empty';
      empty.textContent = '—';
      list.appendChild(empty);
    } else {
      items.forEach((ev) => {
        const row = document.createElement('div');
        row.className = 'cal-row';

        const left = document.createElement('div');
        left.className = 'cal-time';
        left.textContent = ev.timeLabel;

        const mid = document.createElement('div');
        mid.className = 'cal-event';
        mid.textContent = ev.event;

        const right = document.createElement('div');
        right.className = 'cal-stars';
        right.textContent = stars(ev.stars);

        row.appendChild(left);
        row.appendChild(mid);
        row.appendChild(right);
        list.appendChild(row);
      });
    }

    section.appendChild(list);
    container.appendChild(section);
  });
}

/**
 * MarketDB-style init: wire refresh dropdown/button + render into view.
 */
export function initCalendarView({
  viewId = 'calendar-view',
  containerSelector = '.calendar-container',
  lastUpdatedSelector = '.last-updated',
  refreshSelector = '.calendar-refresh-btn' // or your dropdown button
} = {}) {
  const view = document.getElementById(viewId);
  if (!view) return;

  const container = view.querySelector(containerSelector);
  const lastUpdatedEl = view.querySelector(lastUpdatedSelector);
  const refreshBtn = view.querySelector(refreshSelector);

  async function refresh(force = false) {
    const { grouped, lastFetchMs, error } = await calendarService.getWeeklyUS({ force });
    renderCalendar(container, grouped);
    renderLastUpdated(lastUpdatedEl, lastFetchMs, error);
  }

  refreshBtn?.addEventListener('click', async () => {
    calendarService.resetCache();
    await refresh(true);
  });

  // Initial render
  refresh(false);

  // Weekly auto refresh (Fri 6pm ET while open)
  calendarService.scheduleWeeklyRefresh(async () => {
    await refresh(true);
  });
}
