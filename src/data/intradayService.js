import { storage } from './storage.js';
import { twelveDataClient } from './twelveDataClient.js';

const CACHE_PREFIX = 'macrodb:intraday:v1:'; // + tabId + ':' + symbol + ':' + range
const NY_TZ = 'America/New_York';

// Market window you asked for
const SESSION_START = { h: 9, m: 0 };
const SESSION_END = { h: 16, m: 30 };

function key(tabId, symbol, range) {
  return `${CACHE_PREFIX}${tabId}:${String(symbol).toUpperCase()}:${range}`;
}

function parseBars(td) {
  // TwelveData returns newest-first; we sort oldest-first.
  const values = Array.isArray(td?.values) ? td.values : [];
  const bars = [];
  for (const v of values) {
    const dt = v?.datetime;
    const t = new Date(dt).getTime();
    const o = Number(v?.open);
    const h = Number(v?.high);
    const l = Number(v?.low);
    const c = Number(v?.close);
    if (!Number.isFinite(t) || !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) continue;
    bars.push({ t, o, h, l, c });
  }
  bars.sort((a, b) => a.t - b.t);
  return bars;
}

function withinSessionNY(dt) {
  // dt is JS Date in local runtime tz, but the string from TwelveData is already in exchange/timezone context
  // We just filter by HH:MM extracted from the timestamp text in practice.
  const hh = dt.getHours();
  const mm = dt.getMinutes();
  const afterStart = (hh > SESSION_START.h) || (hh === SESSION_START.h && mm >= SESSION_START.m);
  const beforeEnd = (hh < SESSION_END.h) || (hh === SESSION_END.h && mm <= SESSION_END.m);
  return afterStart && beforeEnd;
}

function filterToRecentSessions(bars, maxDays) {
  // Keep only last N unique calendar days (based on bar timestamp).
  const days = [];
  const out = [];
  for (let i = bars.length - 1; i >= 0; i--) {
    const d = new Date(bars[i].t);
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!days.includes(ymd)) days.push(ymd);
    if (days.length > maxDays) break;
  }
  const keep = new Set(days);
  for (const b of bars) {
    const d = new Date(b.t);
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!keep.has(ymd)) continue;
    if (!withinSessionNY(d)) continue;
    out.push(b);
  }
  return out;
}

function rangeParams(range) {
  // Keep requests efficient.
  if (range === '1D') return { interval: '1min', date: 'today', outputsize: 600 };
  if (range === '1W') return { interval: '15min', outputsize: 1200 };
  return { interval: '1h', outputsize: 1500 }; // '1M'
}

function postFilter(range, bars) {
  if (range === '1D') {
    // Today session only
    return bars.filter((b) => withinSessionNY(new Date(b.t)));
  }
  if (range === '1W') return filterToRecentSessions(bars, 5);
  return filterToRecentSessions(bars, 21); // ~1M trading days
}

export const intradayService = {
  getCached(tabId, symbol, range) {
    const obj = storage.getJSON(key(tabId, symbol, range));
    return obj?.bars ? obj : null;
  },

  async fetch(tabId, symbol, range, { force = false } = {}) {
    const cacheKey = key(tabId, symbol, range);
    const cached = storage.getJSON(cacheKey);

    const ttlMs = range === '1D' ? 2 * 60 * 1000 : 30 * 60 * 1000;
    const age = cached?.fetchedAtMs ? (Date.now() - cached.fetchedAtMs) : Infinity;

    if (!force && cached?.bars && age < ttlMs) return cached;

    const { interval, date, outputsize } = rangeParams(range);

    const td = await twelveDataClient.timeSeries({
      keyName: tabId,
      symbol,
      interval,
      outputsize,
      date,
      timezone: NY_TZ
    });

    const bars = postFilter(range, parseBars(td));
    const obj = { bars, fetchedAtMs: Date.now() };
    storage.setJSON(cacheKey, obj);
    return obj;
  }
};
