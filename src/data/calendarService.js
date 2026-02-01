import { apiClient } from './apiClient.js';
import { storage } from './storage.js';
import { nyTime } from './time.js';

const CACHE_KEY = 'md_macro_calendar_v1';
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

function ymdLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function computeStars(eventName, impactRaw) {
  const name = String(eventName || '').toLowerCase();
  const impact = String(impactRaw || '').toLowerCase();
  if (impact === 'high') return 3;
  if (impact === 'medium') return 2;
  if (impact === 'low') return 1;

  const is3 =
    name.includes('fomc') ||
    name.includes('interest rate decision') ||
    name.includes('cpi') ||
    name.includes('pce') ||
    name.includes('nonfarm') ||
    name.includes('nfp') ||
    (name.includes('unemployment') && name.includes('rate')) ||
    name.includes('average hourly') ||
    name.includes('ism') ||
    (name.includes('gdp') && (name.includes('advance') || name.includes('prelim') || name.includes('preliminary')));

  if (is3) return 3;

  const is2 =
    name.includes('jobless') ||
    name.includes('initial claims') ||
    name.includes('continuing claims') ||
    name.includes('jolts') ||
    name.includes('retail sales') ||
    name.includes('adp') ||
    name.includes('ppi') ||
    name.includes('consumer confidence') ||
    name.includes('michigan') ||
    name.includes('housing starts') ||
    name.includes('building permits');

  if (is2) return 2;
  return 1;
}

function groupByWeekdayET(events) {
  const grouped = {};
  for (const d of DAYS) grouped[d] = [];

  for (const ev of events) {
    const tSec = nyTime.parseEventTimeToSec(ev.time);
    const weekday = nyTime.weekdayName(tSec);
    if (!grouped[weekday]) continue;

    grouped[weekday].push({
      timeSec: tSec,
      timeLabel: nyTime.formatTime(tSec),
      event: ev.event,
      stars: ev.stars
    });
  }

  for (const d of DAYS) grouped[d].sort((a, b) => a.timeSec - b.timeSec);
  return grouped;
}

function getWeekRangeET(now = new Date()) {
  // Mon–Fri; after Fri 6pm ET => next week
  const nowSec = Math.floor(now.getTime() / 1000);
  const parts = nyTime.parts(nowSec);
  const local = new Date(`${parts.month}/${parts.day}/${parts.year} ${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:00`);

  const day = local.getDay(); // 0 Sun .. 5 Fri
  const hour = local.getHours();
  const afterFriClose = (day === 5 && hour >= 18) || day === 6 || day === 0;

  const ref = new Date(local);
  if (afterFriClose) {
    const daysToNextMonday = ((8 - day) % 7) || 7;
    ref.setDate(ref.getDate() + daysToNextMonday);
    ref.setHours(0, 0, 0, 0);
  }

  const refDay = ref.getDay();
  const diffToMonday = refDay === 0 ? -6 : 1 - refDay;

  const monday = new Date(ref);
  monday.setDate(ref.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);

  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  friday.setHours(23, 59, 59, 999);

  return { monday, friday };
}

function cachedSnap() {
  return storage.getJSON(CACHE_KEY);
}

export const calendarService = {
  getCached() {
    return cachedSnap();
  },

  getLastFetchMs() {
    return cachedSnap()?.lastFetchMs || null;
  },

  async getWeeklyUS({ force = false } = {}) {
    const cached = cachedSnap();
    if (!force && cached?.grouped) {
      return { grouped: cached.grouped, lastFetchMs: cached.lastFetchMs, error: null };
    }

    const { monday, friday } = getWeekRangeET(new Date());
    const from = ymdLocal(monday);
    const to = ymdLocal(friday);

    try {
      const res = await apiClient.economicCalendar({ from, to, keyName: 'calendar' });
      const list = Array.isArray(res?.economicCalendar) ? res.economicCalendar : [];

      const us = list
        .filter((x) => String(x.country || '').toUpperCase() === 'US')
        .map((x) => ({ ...x, stars: computeStars(x.event, x.impact) }))
        .filter((x) => x.stars >= 2);

      const grouped = groupByWeekdayET(us);
      const snap = { lastFetchMs: Date.now(), grouped };
      storage.setJSON(CACHE_KEY, snap);
      return { grouped, lastFetchMs: snap.lastFetchMs, error: null };
    } catch (e) {
      return { grouped: cached?.grouped || null, lastFetchMs: cached?.lastFetchMs || null, error: e?.message || 'calendar error' };
    }
  },

  resetCache() {
    storage.remove(CACHE_KEY);
  },

  scheduleWeeklyRefresh(onRefresh) {
    function msUntilNextFri6pmET() {
      const nowSec = Math.floor(Date.now() / 1000);
      const p = nyTime.parts(nowSec);

      const nowET = new Date(`${p.month}/${p.day}/${p.year} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}:00`);
      const d = new Date(nowET);

      const day = d.getDay();
      const hour = d.getHours();
      let daysToFri = (5 - day + 7) % 7;
      if (daysToFri === 0 && hour >= 18) daysToFri = 7;

      d.setDate(d.getDate() + daysToFri);
      d.setHours(18, 0, 0, 0);

      return Math.max(1000, d.getTime() - nowET.getTime());
    }

    const first = setTimeout(async () => {
      await onRefresh?.();
      setInterval(() => onRefresh?.(), 7 * 24 * 60 * 60 * 1000);
    }, msUntilNextFri6pmET());

    return () => clearTimeout(first);
  }
};