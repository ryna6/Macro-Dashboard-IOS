// src/data/quoteService.js
// Overview tiles: last price + % change + logo.
//
// - Overview uses quotes (since intraday candles may be plan-limited).
// - Metals use /forex/rates base=USD and invert to get XAUUSD etc.
// - 1W/1M change needs a historical baseline. We build a daily-close map.
//   If missing, we try to backfill via Finnhub daily candles (resolution 'D').
//   If your plan blocks candles entirely, 1W/1M will remain '—' until you add a candle provider.

import { apiClient } from './apiClient.js';
import { macroConfig } from './macroConfig.js';
import { storage } from './storage.js';
import { nyTime } from './time.js';
import { TIMEFRAMES } from './candleService.js';

const DISK_PREFIX = 'macrodb:quotes:v2:'; // + tabId

// In-memory cache: tabId -> Map(symbolKey -> rec)
const mem = new Map();

const QUOTE_TTL_MS = 2 * 60 * 1000;           // re-quote quickly
const HISTORY_TTL_MS = 12 * 60 * 60 * 1000;   // daily history doesn't need to refresh often
const LOGO_TTL_MS = 30 * 24 * 60 * 60 * 1000; // logos rarely change
const REQUEST_SPACING_MS = 120;

// Forex symbol discovery (for history candles only). Cached for 30 days.
// We *don't* use this for fast live pricing (we use /forex/rates for that).
const FOREX_MAP_KEY = 'macrodb:forexMap:v1';
const FOREX_MAP_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function nowMs() { return Date.now(); }
function nowSec() { return Math.floor(Date.now() / 1000); }
function isFiniteNum(x) { return typeof x === 'number' && Number.isFinite(x); }

function tabDiskKey(tabId) {
  return `${DISK_PREFIX}${tabId}`;
}

function loadTabDisk(tabId) {
  return storage.get(tabDiskKey(tabId)) || { symbols: {}, lastUpdatedMs: 0 };
}

function saveTabDisk(tabId, obj) {
  storage.set(tabDiskKey(tabId), obj);
}

function getTabMem(tabId) {
  if (!mem.has(tabId)) mem.set(tabId, new Map());
  return mem.get(tabId);
}

function sKey(spec) {
  return `${spec.type}:${spec.symbol}`;
}

async function getForexMap(tabId, { force = false } = {}) {
  const cached = storage.get(FOREX_MAP_KEY);
  if (!force && cached?.map && cached?.cachedAtMs && (nowMs() - cached.cachedAtMs) < FOREX_MAP_TTL_MS) {
    return cached;
  }

  // Prefer OANDA for metal pairs.
  const exchanges = ['OANDA', 'FX_IDC', 'FOREXCOM'];
  for (const ex of exchanges) {
    try {
      const list = await apiClient.forexSymbols({ keyName: tabId, exchange: ex });
      if (!Array.isArray(list) || list.length === 0) continue;

      const map = {};
      for (const row of list) {
        const disp = String(row?.displaySymbol || '').toUpperCase();
        const sym = String(row?.symbol || '').toUpperCase();
        if (!disp || !sym) continue;
        // disp like XAU/USD -> compact XAUUSD
        const compact = disp.replace(/[^A-Z0-9]/g, '');
        if (compact && !map[compact]) map[compact] = sym;
      }

      if (Object.keys(map).length) {
        const out = { exchange: ex, map, cachedAtMs: nowMs() };
        storage.set(FOREX_MAP_KEY, out);
        return out;
      }
    } catch {
      // try next exchange
    }
  }

  const empty = { exchange: null, map: {}, cachedAtMs: nowMs() };
  storage.set(FOREX_MAP_KEY, empty);
  return empty;
}

function pctChange(from, to) {
  if (!isFiniteNum(from) || !isFiniteNum(to) || from === 0) return null;
  return ((to - from) / from) * 100;
}

function nyYmdFromUtcSec(utcSec) {
  const p = nyTime.parts(utcSec);
  const m = String(p.month).padStart(2, '0');
  const d = String(p.day).padStart(2, '0');
  return `${p.year}-${m}-${d}`;
}

function lastWeekdayKey(ms) {
  let t = ms;
  while (nyTime.isWeekend(Math.floor(t / 1000))) t -= 24 * 60 * 60 * 1000;
  return nyYmdFromUtcSec(Math.floor(t / 1000));
}

function getBaselineFromDaily(dailyObj, sessionsBack) {
  const keys = Object.keys(dailyObj || {}).sort();
  if (keys.length < sessionsBack + 1) return null;
  return dailyObj[keys[keys.length - 1 - sessionsBack]];
}

function mergeDiskIntoMem(tabId) {
  const disk = loadTabDisk(tabId);
  const m = getTabMem(tabId);
  for (const [k, v] of Object.entries(disk.symbols || {})) {
    if (!m.has(k)) m.set(k, v);
  }
}

function writeSymbol(tabId, key, rec) {
  // mem
  getTabMem(tabId).set(key, rec);

  // disk
  const disk = loadTabDisk(tabId);
  disk.symbols ||= {};

  disk.symbols[key] = {
    symbol: rec.symbol,
    type: rec.type,
    quote: rec.quote ? {
      c: rec.quote.c,
      dp: rec.quote.dp,
      pc: rec.quote.pc,
      t: rec.quote.t
    } : null,
    updatedMs: rec.updatedMs || 0,
    daily: rec.daily || {},
    historyFetchedAtMs: rec.historyFetchedAtMs || 0,
    logoUrl: rec.logoUrl || null,
    logoFetchedAtMs: rec.logoFetchedAtMs || 0,
    spark: rec.spark || []
  };

  disk.lastUpdatedMs = Math.max(disk.lastUpdatedMs || 0, rec.updatedMs || 0);
  saveTabDisk(tabId, disk);
}

function shouldFetchQuote(rec, force) {
  if (force) return true;
  if (!rec?.quote) return true;
  const age = nowMs() - (rec.updatedMs || 0);
  return age > QUOTE_TTL_MS;
}

function shouldFetchHistory(rec, force) {
  if (force) return true;
  const age = nowMs() - (rec.historyFetchedAtMs || 0);
  return age > HISTORY_TTL_MS;
}

function shouldFetchLogo(rec) {
  if (rec?.logoUrl) {
    const age = nowMs() - (rec.logoFetchedAtMs || 0);
    return age > LOGO_TTL_MS;
  }
  return true;
}

// --- Metals via forex rates (USD base) -------------------------------------

function parseFxPair(pair) {
  const s = String(pair || '').toUpperCase();
  if (s.length < 6) return null;
  return { base: s.slice(0, 3), quote: s.slice(3, 6) };
}

function priceFromUsdBaseRates(pair, rates) {
  const p = parseFxPair(pair);
  if (!p) return null;
  if (p.quote !== 'USD') return null;

  // /forex/rates base=USD -> quote map where quote[XAU] means:
  // 1 USD = quote[XAU] XAU  => 1 XAU = 1/quote[XAU] USD
  const r = rates?.quote?.[p.base];
  if (!isFiniteNum(r) || r === 0) return null;
  return 1 / r;
}

// --- Daily history backfill (tries Finnhub daily candles) ------------------

function parseFinnhubCandleResponse(json) {
  if (!json || json.s !== 'ok') return [];
  const t = json.t || [];
  const c = json.c || [];
  const out = [];
  const n = Math.min(t.length, c.length);
  for (let i = 0; i < n; i++) {
    const ts = Number(t[i]);
    const close = Number(c[i]);
    if (Number.isFinite(ts) && Number.isFinite(close)) out.push({ t: ts, c: close });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

function candlesToDailyMap(candles) {
  const m = {};
  for (const x of candles || []) {
    if (!x?.t || !isFiniteNum(x.c)) continue;
    if (nyTime.isWeekend(x.t)) continue;
    const key = nyYmdFromUtcSec(x.t);
    m[key] = x.c;
  }
  return m;
}

async function backfillDailyHistory(tabId, spec, rec) {
  if (nyTime.isWeekend(nowSec())) return;

  const to = nowSec();
  const from = to - 90 * 24 * 3600;

  try {
    let json;
    if (spec.type === 'forex') {
      const fx = await getForexMap(tabId);
      const resolved = fx?.map?.[String(spec.symbol || '').toUpperCase()] || spec.symbol;
      json = await apiClient.forexCandles({ keyName: tabId, symbol: resolved, resolution: 'D', from, to });
    } else {
      json = await apiClient.stockCandles({ keyName: tabId, symbol: spec.symbol, resolution: 'D', from, to });
    }

    const candles = parseFinnhubCandleResponse(json);
    const map = candlesToDailyMap(candles);

    rec.daily ||= {};
    Object.assign(rec.daily, map);
    rec.historyFetchedAtMs = nowMs();
  } catch {
    rec.historyFetchedAtMs = nowMs();
  }
}

async function fetchLogo(tabId, spec, rec) {
  if (spec.type !== 'stock') return;

  try {
    const p = await apiClient.stockProfile2({ keyName: tabId, symbol: spec.symbol });
    const logo = (p?.logo && String(p.logo).trim()) ? String(p.logo).trim() : '';
    if (logo) {
      rec.logoUrl = logo;
      rec.logoFetchedAtMs = nowMs();
    } else {
      rec.logoFetchedAtMs = nowMs();
    }
  } catch {
    rec.logoFetchedAtMs = nowMs();
  }
}

export const quoteService = {
  TIMEFRAMES,

  getTabLastUpdatedMs(tabId) {
    return loadTabDisk(tabId)?.lastUpdatedMs || 0;
  },

  getSnapshot(tabId, spec, timeframe) {
    mergeDiskIntoMem(tabId);
    const key = sKey(spec);
    const rec = getTabMem(tabId).get(key);

    const q = rec?.quote;
    const last = isFiniteNum(q?.c) ? q.c : null;

    const intradayPct = isFiniteNum(q?.dp)
      ? q.dp
      : (isFiniteNum(q?.pc) ? pctChange(q.pc, q.c) : null);

    let changePct = null;
    if (last != null) {
      if (timeframe === TIMEFRAMES.ONE_DAY) {
        changePct = intradayPct;
      } else if (timeframe === TIMEFRAMES.ONE_WEEK) {
        const base = getBaselineFromDaily(rec?.daily, 5);
        changePct = pctChange(base, last);
      } else if (timeframe === TIMEFRAMES.ONE_MONTH) {
        const base = getBaselineFromDaily(rec?.daily, 21);
        changePct = pctChange(base, last);
      }
    }

    return {
      last,
      changePct,
      intradayPct,
      spark: rec?.spark || null,
      logoUrl: rec?.logoUrl || null
    };
  },

  async prefetchTab(tabId, { force = false } = {}) {
    mergeDiskIntoMem(tabId);

    const tab = macroConfig.tabs.find(t => t.id === tabId);
    if (!tab || tab.kind !== 'macro') return;

    const specs = tab.symbols || [];
    const fxSpecs = specs.filter(s => s.type === 'forex');
    const stockSpecs = specs.filter(s => s.type !== 'forex');

    const m = getTabMem(tabId);
    const disk = loadTabDisk(tabId);
    let lastUpdatedMs = disk?.lastUpdatedMs || 0;

    // 1) Metals/FX: one call to /forex/rates base=USD
    let usdRates = null;
    if (fxSpecs.length) {
      try {
        if (!nyTime.isWeekend(nowSec())) {
          usdRates = await apiClient.forexRates({ keyName: tabId, base: 'USD' });
        }
      } catch {
        usdRates = null;
      }
    }

    for (const spec of fxSpecs) {
      const key = sKey(spec);
      const existing = m.get(key) || {
        symbol: spec.symbol,
        type: spec.type,
        quote: null,
        updatedMs: 0,
        daily: (disk.symbols?.[key]?.daily) || {},
        historyFetchedAtMs: disk.symbols?.[key]?.historyFetchedAtMs || 0,
        logoUrl: null,
        logoFetchedAtMs: 0,
        spark: (disk.symbols?.[key]?.spark) || []
      };

      if (!shouldFetchQuote(existing, force)) continue;

      const price = usdRates ? priceFromUsdBaseRates(spec.symbol, usdRates) : null;
      if (isFiniteNum(price)) {
        const ms = nowMs();
        const t = Math.floor(ms / 1000);
        const keyDay = lastWeekdayKey(ms);

        const pc = existing.daily?.[keyDay] ?? getBaselineFromDaily(existing.daily, 1);
        const dp = pctChange(pc, price);

        existing.quote = {
          c: price,
          pc: isFiniteNum(pc) ? pc : undefined,
          dp: isFiniteNum(dp) ? dp : undefined,
          t
        };
        existing.updatedMs = ms;

        existing.daily ||= {};
        existing.daily[keyDay] = price;

        existing.spark ||= [];
        existing.spark.push({ t: ms, p: price });
        if (existing.spark.length > 30) existing.spark = existing.spark.slice(-30);

        writeSymbol(tabId, key, existing);
        lastUpdatedMs = Math.max(lastUpdatedMs, ms);
      }

      // Backfill daily history so 1W/1M works for metals.
      const haveWeek = !!getBaselineFromDaily(existing.daily, 5);
      const haveMonth = !!getBaselineFromDaily(existing.daily, 21);
      if ((!(haveWeek && haveMonth) || force) && shouldFetchHistory(existing, force)) {
        await backfillDailyHistory(tabId, spec, existing);
        writeSymbol(tabId, key, existing);
        await sleep(REQUEST_SPACING_MS);
      }
    }

    // 2) Stocks/ETFs: /quote per symbol (spaced)
    for (const spec of stockSpecs) {
      const key = sKey(spec);
      const existing = m.get(key) || {
        symbol: spec.symbol,
        type: spec.type,
        quote: null,
        updatedMs: 0,
        daily: (disk.symbols?.[key]?.daily) || {},
        historyFetchedAtMs: disk.symbols?.[key]?.historyFetchedAtMs || 0,
        logoUrl: disk.symbols?.[key]?.logoUrl || null,
        logoFetchedAtMs: disk.symbols?.[key]?.logoFetchedAtMs || 0,
        spark: (disk.symbols?.[key]?.spark) || []
      };

      if (shouldFetchQuote(existing, force)) {
        const candidates = [spec.symbol];
        if (spec.fallback) candidates.push(spec.fallback);

        let q = null;
        let used = null;
        for (const sym of candidates) {
          try {
            const resp = await apiClient.quote({ keyName: tabId, symbol: sym });
            if (resp && isFiniteNum(resp.c) && resp.c !== 0) {
              q = resp;
              used = sym;
              break;
            }
          } catch {}
        }

        const ms = nowMs();
        existing.quote = q;
        existing.updatedMs = ms;
        existing.resolvedSymbol = used;

        const dayKey = lastWeekdayKey(ms);
        if (q && isFiniteNum(q.c)) {
          existing.daily ||= {};
          existing.daily[dayKey] = q.c;

          existing.spark ||= [];
          existing.spark.push({ t: ms, p: q.c });
          if (existing.spark.length > 30) existing.spark = existing.spark.slice(-30);
        }

        writeSymbol(tabId, key, existing);
        lastUpdatedMs = Math.max(lastUpdatedMs, ms);

        await sleep(REQUEST_SPACING_MS);
      }

      if (shouldFetchLogo(existing)) {
        await fetchLogo(tabId, spec, existing);
        writeSymbol(tabId, key, existing);
        await sleep(REQUEST_SPACING_MS);
      }

      const haveWeek = !!getBaselineFromDaily(existing.daily, 5);
      const haveMonth = !!getBaselineFromDaily(existing.daily, 21);
      if ((!(haveWeek && haveMonth) || force) && shouldFetchHistory(existing, force)) {
        await backfillDailyHistory(tabId, spec, existing);
        writeSymbol(tabId, key, existing);
        await sleep(REQUEST_SPACING_MS);
      }
    }

    const out = loadTabDisk(tabId);
    out.lastUpdatedMs = Math.max(out.lastUpdatedMs || 0, lastUpdatedMs || 0);
    saveTabDisk(tabId, out);
  }
};
