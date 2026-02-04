// src/data/intradayService.js
//
// Intraday OHLC provider using Twelve Data /time_series.
// - Filters to 09:00–16:30 ET to avoid “flat overnight” charts
// - Cached in localStorage
// - Used for overview sparkline + expanded OHLC view

import { storage } from './storage.js';
import { twelveDataClient } from './twelveDataClient.js';
import { nyTime } from './time.js';

const CACHE_PREFIX = 'macrodb:intraday:v1:'; // + tabId:symbol:range

const TTL_MS = {
  '1D': 2 * 60 * 1000,
  '1W': 10 * 60 * 1000,
  '1M': 30 * 60 * 1000
};

const SESSION_START = { hour: 9, minute: 0 };
const SESSION_END = { hour: 16, minute: 30 };

const REQUEST_SPACING_MS = 120;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function key(tabId, symbol, range) {
  return `${CACHE_PREFIX}${String(tabId)}:${String(symbol).toUpperCase()}:${String(range)}`;
}

function parseYmdHms(dt) {
  const s = String(dt || '').trim();
  const m = s.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})(?:[ T]([0-9]{2}):([0-9]{2})(?::([0-9]{2}))?)?$/);
  if (!m) return null;
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: m[4] == null ? 0 : Number(m[4]),
    minute: m[5] == null ? 0 : Number(m[5]),
    second: m[6] == null ? 0 : Number(m[6])
  };
}

function toUtcSecFromNyDatetimeString(dt) {
  const parts = parseYmdHms(dt);
  if (!parts) {
    const t = new Date(String(dt || '')).getTime();
    return Number.isFinite(t) ? Math.floor(t / 1000) : null;
  }

  return nyTime.zonedToUtcSec({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second
  });
}

function isWithinSession(utcSec) {
  if (!Number.isFinite(utcSec)) return false;
  const p = nyTime.parts(utcSec);
  const afterStart = p.hour > SESSION_START.hour || (p.hour === SESSION_START.hour && p.minute >= SESSION_START.minute);
  const beforeEnd = p.hour < SESSION_END.hour || (p.hour === SESSION_END.hour && p.minute <= SESSION_END.minute);
  return afterStart && beforeEnd;
}

function pickRecentTradingDays(candles, nDays) {
  const days = [];
  const seen = new Set();
  for (let i = candles.length - 1; i >= 0; i--) {
    const ymd = nyTime.ymd(candles[i].t);
    if (!seen.has(ymd)) {
      seen.add(ymd);
      days.push(ymd);
      if (days.length >= nDays) break;
    }
  }
  if (!days.length) return [];
  const allowed = new Set(days);
  return candles.filter((c) => allowed.has(nyTime.ymd(c.t)));
}

function normalizeTimeSeriesToCandles(data) {
  const values = data?.values || data?.data?.values || [];
  if (!Array.isArray(values) || values.length === 0) return [];

  const out = [];
  for (const v of values) {
    const dt = v?.datetime || v?.date || v?.timestamp;
    const t = toUtcSecFromNyDatetimeString(dt);
    const o = Number(v?.open);
    const h = Number(v?.high);
    const l = Number(v?.low);
    const c = Number(v?.close);
    if (!Number.isFinite(t) || !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) continue;
    out.push({ t, o, h, l, c });
  }

  out.sort((a, b) => a.t - b.t);
  return out;
}

function postFilter(range, candles) {
  const weekdaySession = (candles || []).filter((c) => !nyTime.isWeekend(c.t) && isWithinSession(c.t));
  if (range === '1D') return pickRecentTradingDays(weekdaySession, 1); // ✅ always keep only latest day
  if (range === '1W') return pickRecentTradingDays(weekdaySession, 5);
  return pickRecentTradingDays(weekdaySession, 21);
}

function shouldTryFallback(err) {
  const msg = String(err?.message || '').toLowerCase();
  // allow fallbacks on common plan/param errors
  return (
    msg.includes('interval') ||
    msg.includes('not supported') ||
    msg.includes('not available') ||
    msg.includes('date') ||
    msg.includes('format') ||
    msg.includes('invalid')
  );
}

async function fetchTimeSeriesWithFallbacks({ tabId, symbol, range, signal }) {
  // ✅ 1D: 5min (date=today) -> 15min (date=today) -> 5min (no date)
  // ✅ 1W: 15min
  // ✅ 1M: 2h -> 4h

  const attempts = [];

  if (range === '1D') {
    attempts.push({ interval: '5min', date: 'today', outputsize: 400 });
    attempts.push({ interval: '15min', date: 'today', outputsize: 260 });
    attempts.push({ interval: '5min', outputsize: 600 }); // no date fallback
  } else if (range === '1W') {
    attempts.push({ interval: '15min', outputsize: 1200 });
    attempts.push({ interval: '30min', outputsize: 1200 });
  } else {
    attempts.push({ interval: '2h', outputsize: 1600 });
    attempts.push({ interval: '4h', outputsize: 1600 });
  }

  let lastErr = null;
  for (const a of attempts) {
    try {
      const td = await twelveDataClient.timeSeries({
        keyName: tabId,
        symbol,
        interval: a.interval,
        outputsize: a.outputsize,
        date: a.date,
        timezone: 'America/New_York',
        signal
      });
      return { td, usedInterval: a.interval };
    } catch (err) {
      lastErr = err;
      if (!shouldTryFallback(err)) throw err;
    }
  }

  throw lastErr || new Error('Failed to fetch time series');
}

export const intradayService = {
  getCached(tabId, symbol, range) {
    return storage.getJSON(key(tabId, symbol, range));
  },

  async fetch(tabId, symbol, range, { force = false, signal } = {}) {
    const k = key(tabId, symbol, range);
    const cached = storage.getJSON(k);

    const ttl = TTL_MS[String(range)] ?? (10 * 60 * 1000);
    const age = cached?.fetchedAtMs ? Date.now() - cached.fetchedAtMs : Infinity;
    if (!force && cached?.candles && age < ttl) return cached;

    const { td } = await fetchTimeSeriesWithFallbacks({ tabId, symbol, range, signal });
    let candles = postFilter(range, normalizeTimeSeriesToCandles(td));

    // If "today" is empty (weekend / before market), fallback to latest session from 1W fetch.
    if (range === '1D' && (!candles || candles.length < 2)) {
      const { td: fallbackTd } = await fetchTimeSeriesWithFallbacks({
        tabId,
        symbol,
        range: '1W',
        signal
      });
      const fb = postFilter('1W', normalizeTimeSeriesToCandles(fallbackTd));
      candles = pickRecentTradingDays(fb, 1);
    }

    const obj = { candles, fetchedAtMs: Date.now() };
    storage.setJSON(k, obj);
    return obj;
  },

  async prefetchTab(tabId, specs, range, { force = false } = {}) {
    const list = Array.isArray(specs) ? specs : [];
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      await this.fetch(tabId, s.symbol, range, { force }).catch(() => null);
      if (i < list.length - 1) await sleep(REQUEST_SPACING_MS);
    }
  }
};
