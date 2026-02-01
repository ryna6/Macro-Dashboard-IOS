import { calendarService } from '../data/calendarService.js';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

function stars(n) {
  if (n >= 3) return '★★★';
  if (n === 2) return '★★';
  return '★';
}

function renderCalendar(container, grouped) {
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

export function initCalendarView(container) {
  async function refresh({ force = false } = {}) {
    const { grouped } = await calendarService.getWeeklyUS({ force });
    renderCalendar(container, grouped);
  }

  function renderFromCache() {
    const cached = calendarService.getCached?.();
    if (cached?.grouped) renderCalendar(container, cached.grouped);
  }

  // initial
  renderFromCache();
  refresh({ force: false });

  // weekly schedule while open (Fri 6pm ET)
  calendarService.scheduleWeeklyRefresh(async () => {
    await refresh({ force: true });
  });

  return { refresh, renderFromCache };
}
