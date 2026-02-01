// src/data/quoteService.js
// Finnhub quotes power the *overview tiles* (last price + % change).
// Candles may be premium — so we treat candles as optional and keep tiles alive with /quote.

import { apiClient } from './apiClient.js';
import { storage } from './storage.js';
import { nyTime } from './time.js';
import { TIMEFRAMES } from './candleService.js';

const TAB_CACHE_PREFIX = 'macrodb:quotes:v1:'; // + tabId

// Per-tab in-memory cache (fast UI)
const mem = new Map(); // tabId -> Map(symbolKey -> record)

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function symbolKey(spec) {
  return `${spec.type}:${spec.symbol}`;
}

function isFiniteNum(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

function nowMs() { return Date.now(); }

function getTabMem(tabId) {
  if (!mem.has(tabId)) mem.set(tabId, new Map());
  return mem.get(tabId);
}

function loadTabDisk(tabId) {
  return storage.get(`${TAB_CACHE_PREFIX}${tabId}`) || { symbols: {}, lastUpdatedMs: 0, forexMap: null };
}

function saveTabDisk(tabId, obj) {
  storage.set(`${TAB_CACHE_PREFIX}${tabId}`, obj);
}

function nyYmd(ms) {
  const p = nyTime.parts(Math.floor(ms / 1000));
  return `${p.year}-${p.month}-${p.day}`;
}

function isWeekendNy(ms) {
  const p = nyTime.parts(Math.floor(ms / 1000));
  return p.weekdayShort === 'Sat' || p.weekdayShort === 'Sun';
}

function lastWeekdayKey(ms) {
  let t = ms;
  while (isWeekendNy(t)) t -= 24 * 60 * 60 * 1000;
  return nyYmd(t);
}

function pctChange(from, to) {
  if (!isFiniteNum(from) || !isFiniteNum(to) || from === 0) return null;
  return ((to - from) / from) * 100;
}

// --- Forex symbol mapping (OANDA etc) ---------------------------------------
// We reuse your existing “displaySymbol → symbol” approach from candleService.
const FOREX_MAP_KEY = 'macrodb:forexMap:v1';

async function getForexMapCached({ keyName = 'metals', force = false } = {}) {
  const cached = storage.get(FOREX_MAP_KEY);
  if (cached && !force) return cached;

  // Prefer OANDA because it usually contains XAU/XAG pairs.
  // If OANDA is unavailable, you can extend this list.
  const exchanges = ['OANDA', 'FX_IDC', 'FOREXCOM'];

  for (const ex of exchanges) {
    try {
      const symbols = await apiClient.forexSymbols(keyName, ex);
      if (!Array.isArray(symbols) || symbols.length === 0) continue;

      const map = {};
      for (const s of symbols) {
        // s.displaySymbol is typically like "XAU/USD"
        if (s?.displaySymbol && s?.symbol) {
          map[s.displaySymbol.toUpperCase()] = s.symbol;
        }
      }

      if (Object.keys(map).length > 0) {
        storage.set(FOREX_MAP_KEY, { exchange: ex, map, cachedAtMs: nowMs() });
        return storage.get(FOREX_MAP_KEY);
      }
    } catch {
      // try next exchange
    }
  }

  // If nothing worked, return empty map so we don't refetch constantly.
  const empty = { exchange: null, map: {}, cachedAtMs: nowMs() };
  storage.set(FOREX_MAP_KEY, empty);
  return empty;
}

function fxDisplayFromPair(pair) {
  // "XAUUSD" -> "XAU/USD"
  if (!pair || pair.length < 6) return pair;
  return `${pair.slice(0, 3)}/${pair.slice(3)}`.toUpperCase();
}

// --- Quote fetching & caching -----------------------------------------------

const QUOTE_TTL_MS = 2 * 60 * 1000; // overview quotes can go stale quickly
const REQUEST_SPACING_MS = 120;     // small spacing to be kind to rate limits

function shouldFetch(rec, force) {
  if (force) return true;
  if (!rec?.quote) return true;
  const age = nowMs() - (rec.updatedMs || 0);
  return age > QUOTE_TTL_MS;
}

async function resolveFetchSymbol(tabId, spec) {
  if (spec.type === 'forex') {
    const fx = await getForexMapCached({ keyName: tabId });
    const disp = fxDisplayFromPair(spec.symbol);
    const mapped = fx?.map?.[disp];
    return mapped || spec.symbol; // last resort: try raw
  }
  return spec.symbol;
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

  // disk (keep only light data)
  const disk = loadTabDisk(tabId);
  disk.symbols ||= {};
  disk.symbols[key] = {
    symbol: rec.symbol,
    type: rec.type,
    quote: rec.quote ? {
      c: rec.quote.c,
      d: rec.quote.d,
      dp: rec.quote.dp,
      o: rec.quote.o,
      h: rec.quote.h,
      l: rec.quote.l,
      pc: rec.quote.pc,
      t: rec.quote.t
    } : null,
    updatedMs: rec.updatedMs || 0,
    daily: rec.daily || {}
  };
  disk.lastUpdatedMs = Math.max(disk.lastUpdatedMs || 0, rec.updatedMs || 0);
  saveTabDisk(tabId, disk);
}

function updateDaily(rec, ms) {
  const key = lastWeekdayKey(ms);
  rec.daily ||= {};
  if (rec.quote && isFiniteNum(rec.quote.c)) {
    rec.daily[key] = rec.quote.c;
  }
}

function getBaselineFromDaily(dailyObj, sessionsBack) {
  const keys = Object.keys(dailyObj || {}).sort(); // YYYY-MM-DD sorts lexicographically
  if (keys.length < sessionsBack + 1) return null;
  return dailyObj[keys[keys.length - 1 - sessionsBack]];
}

export const quoteService = {
  TIMEFRAMES,

  getTabLastUpdatedMs(tabId) {
    const disk = loadTabDisk(tabId);
    return disk?.lastUpdatedMs || 0;
  },

  getSnapshot(tabId, spec, timeframe) {
    mergeDiskIntoMem(tabId);

    const key = symbolKey(spec);
    const rec = getTabMem(tabId).get(key);

    const q = rec?.quote;
    const last = isFiniteNum(q?.c) ? q.c : null;

    let changePct = null;

    if (last != null) {
      if (timeframe === TIMEFRAMES.ONE_DAY) {
        // Prefer dp (provided by Finnhub quote), else compute from pc.
        if (isFiniteNum(q?.dp)) changePct = q.dp;
        else if (isFiniteNum(q?.pc) && q.pc !== 0) changePct = pctChange(q.pc, q.c);
      } else if (timeframe === TIMEFRAMES.ONE_WEEK) {
        const base = getBaselineFromDaily(rec?.daily, 5);  // ~5 trading sessions
        changePct = pctChange(base, last);
      } else if (timeframe === TIMEFRAMES.ONE_MONTH) {
        const base = getBaselineFromDaily(rec?.daily, 21); // ~21 trading sessions
        changePct = pctChange(base, last);
      }
    }

    // mini-spark uses last ~30 in-memory quote points (not persisted)
    const spark = rec?.spark || null;

    return { last, changePct, spark };
  },

  async prefetchTab(tabId, specs, { force = false } = {}) {
    mergeDiskIntoMem(tabId);

    const m = getTabMem(tabId);
    const disk = loadTabDisk(tabId);
    let lastUpdatedMs = disk?.lastUpdatedMs || 0;

    for (const spec of specs) {
      const key = symbolKey(spec);
      const existing = m.get(key) || {
        symbol: spec.symbol,
        type: spec.type,
        quote: null,
        updatedMs: 0,
        daily: (disk.symbols?.[key]?.daily) || {},
        spark: []
      };

      if (!shouldFetch(existing, force)) continue;

      // Try primary symbol, then fallback if provided
      const candidates = [spec.symbol];
      if (spec.fallback) candidates.push(spec.fallback);

      let quote = null;
      let usedSymbol = null;

      for (const cand of candidates) {
        try {
          const fetchSpec = { ...spec, symbol: cand };
          const resolved = await resolveFetchSymbol(tabId, fetchSpec);
          const q = await apiClient.quote(tabId, resolved);
          // Finnhub quote returns fields like c, d, dp, h, l, o, pc, t
          if (q && isFiniteNum(q.c) && q.c !== 0) {
            quote = q;
            usedSymbol = resolved;
            break;
          }
        } catch {
          // try next candidate
        }
      }

      existing.symbol = spec.symbol;
      existing.type = spec.type;
      existing.quote = quote;
      existing.resolvedSymbol = usedSymbol;
      existing.updatedMs = nowMs();

      updateDaily(existing, existing.updatedMs);

      // Update spark (in-memory only)
      if (quote && isFiniteNum(quote.c)) {
        existing.spark ||= [];
        existing.spark.push({ t: existing.updatedMs, p: quote.c });
        if (existing.spark.length > 30) existing.spark = existing.spark.slice(existing.spark.length - 30);
      }

      writeSymbol(tabId, key, existing);
      lastUpdatedMs = Math.max(lastUpdatedMs, existing.updatedMs);

      await sleep(REQUEST_SPACING_MS);
    }

    // persist lastUpdated even if no symbols updated
    const out = loadTabDisk(tabId);
    out.lastUpdatedMs = Math.max(out.lastUpdatedMs || 0, lastUpdatedMs || 0);
    saveTabDisk(tabId, out);
  }
};
