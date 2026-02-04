// src/data/intradayService.js
//
// Intraday OHLC provider using Twelve Data /time_series.
//
// Why:
// - Twelve Data time_series can return intraday OHLC (1min/15min/4h...).
// - Filter to session window (09:00–16:30 ET) to avoid “flat overnight” charts.
//
// Notes:
// - Caches by (tabId, symbol, range) in localStorage
// - Fetch is triggered only by refresh/auto-refresh/expanded open

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

function rangeParams(range) {
  if (range === '1D') return { interval: '1min', date: 'today', outputsize: 800 };
  if (range === '1W') return { interval: '15min', outputsize: 1200 };
  return { interval: '4h', outputsize: 1500 }; // 1M
}

function postFilter(range, candles) {
  const weekdaySession = (candles || []).filter((c) => !nyTime.isWeekend(c.t) && isWithinSession(c.t));
  if (range === '1D') return weekdaySession;
  if (range === '1W') return pickRecentTradingDays(weekdaySession, 5);
  return pickRecentTradingDays(weekdaySession, 21);
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

    const { interval, date, outputsize } = rangeParams(range);

    const td = await twelveDataClient.timeSeries({
      keyName: tabId,
      symbol,
      interval,
      outputsize,
      date,
      timezone: 'America/New_York',
      signal
    });

    let candles = postFilter(range, normalizeTimeSeriesToCandles(td));

    // If "today" is empty (common outside session), fallback to trailing window and pick latest session.
    if (range === '1D' && (!candles || candles.length < 2)) {
      const fallback = await twelveDataClient.timeSeries({
        keyName: tabId,
        symbol,
        interval: '1min',
        outputsize: 1200,
        timezone: 'America/New_York',
        signal
      });
      const fb = postFilter('1W', normalizeTimeSeriesToCandles(fallback));
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
