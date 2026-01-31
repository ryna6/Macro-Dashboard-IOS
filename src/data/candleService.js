// src/data/candleService.js
import { apiClient } from './apiClient.js';
import { macroConfig } from './macroConfig.js';
import { storage } from './storage.js';
import { nyTime } from './time.js';

export const TIMEFRAMES = {
  ONE_DAY: '1D',
  ONE_WEEK: '1W',
  ONE_MONTH: '1M'
};

// Cache keys (versioned)
const CACHE_PREFIX = 'md_macro_candles_v1';

// Staleness thresholds (tune as you like)
const STALE_MS = {
  '1D': 2.5 * 60 * 1000,     // intraday should be fresh
  '1H_BASE': 15 * 60 * 1000, // 1h(30D) base can be less frequent
  '1W': 10 * 60 * 1000,
  '1M': 60 * 60 * 1000
};

// In-memory cache: key -> { fetchedAtMs, candles, meta }
const mem = new Map();

// In-flight de-dupe: key -> Promise
const inflight = new Map();

/**
 * Candle object format used internally:
 * { t: number (unix sec), o: number, h: number, l: number, c: number, v?: number }
 */

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function cacheKey(tabId, symbolKey, slot) {
  return `${CACHE_PREFIX}:${tabId}:${symbolKey}:${slot}`;
}

function readCache(tabId, symbolKey, slot) {
  const k = cacheKey(tabId, symbolKey, slot);

  if (mem.has(k)) return mem.get(k);

  const persisted = storage.getJSON(k);
  if (persisted && persisted.candles && persisted.fetchedAtMs) {
    mem.set(k, persisted);
    return persisted;
  }
  return null;
}

function writeCache(tabId, symbolKey, slot, entry) {
  const k = cacheKey(tabId, symbolKey, slot);
  mem.set(k, entry);
  storage.setJSON(k, entry);
}

function isStale(entry, maxAgeMs) {
  if (!entry?.fetchedAtMs) return true;
  return Date.now() - entry.fetchedAtMs > maxAgeMs;
}

function parseFinnhubCandleResponse(json) {
  if (!json || json.s !== 'ok') return [];
  const t = json.t || [];
  const o = json.o || [];
  const h = json.h || [];
  const l = json.l || [];
  const c = json.c || [];
  const v = json.v || [];
  const n = Math.min(t.length, o.length, h.length, l.length, c.length);

  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      t: Number(t[i]),
      o: Number(o[i]),
      h: Number(h[i]),
      l: Number(l[i]),
      c: Number(c[i]),
      v: v[i] == null ? undefined : Number(v[i])
    });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

function normalizeSymbolKey(spec) {
  // A stable key for caching (includes resolved forex symbol if already known)
  return (spec.cacheKey || spec.symbol || '').toUpperCase();
}

function filterWeekdaysOnly(candles) {
  return candles.filter((x) => !nyTime.isWeekend(x.t));
}

/**
 * Pick last N distinct NY weekdays from candles.
 * Returns a (chronological) subset containing all candles within those days.
 */
function pickLastNDays(candles, nDays) {
  const days = [];
  const seen = new Set();

  // walk backwards to collect last distinct days
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
  return candles.filter((x) => allowed.has(nyTime.ymd(x.t)));
}

/**
 * 4-hour aggregation in NY-local bucket boundaries:
 * bucket hour start = floor(localHour/4)*4, minute/second=0
 */
function aggregateTo4h(candles1h) {
  if (!candles1h.length) return [];

  const groups = new Map(); // key -> aggregate

  for (const c of candles1h) {
    const p = nyTime.parts(c.t);
    const bucketHour = Math.floor(p.hour / 4) * 4;

    const bucketUtcSec = nyTime.zonedToUtcSec({
      year: p.year,
      month: p.month,
      day: p.day,
      hour: bucketHour,
      minute: 0,
      second: 0
    });

    const key = `${p.year}-${p.month}-${p.day}-${bucketHour}`;

    if (!groups.has(key)) {
      groups.set(key, {
        t: bucketUtcSec,
        o: c.o,
        h: c.h,
        l: c.l,
        c: c.c,
        v: c.v == null ? undefined : c.v
      });
    } else {
      const g = groups.get(key);
      g.h = Math.max(g.h, c.h);
      g.l = Math.min(g.l, c.l);
      g.c = c.c;
      if (g.v != null && c.v != null) g.v += c.v;
    }
  }

  const out = Array.from(groups.values()).sort((a, b) => a.t - b.t);
  return out;
}

/**
 * Symbol resolution for metals (XAUUSD etc.) using /forex/symbol.
 * We cache a mapping in localStorage so this is effectively one-time.
 */
const FOREX_MAP_KEY = 'md_macro_forex_map_v1';

async function getForexMap() {
  const cached = storage.getJSON(FOREX_MAP_KEY);
  if (cached && cached.map && cached.fetchedAtMs && Date.now() - cached.fetchedAtMs < 30 * 24 * 60 * 60 * 1000) {
    return cached.map;
  }

  // Use "metals" keyName by default for discovery to avoid stealing quota from Global.
  const list = await apiClient.forexSymbols({ exchange: 'OANDA', keyName: 'metals' });

  // Finnhub returns entries like {symbol, displaySymbol, description}
  const map = {};
  for (const row of Array.isArray(list) ? list : []) {
    const display = String(row.displaySymbol || '').toUpperCase(); // e.g. "XAU/USD"
    const sym = String(row.symbol || '').toUpperCase();           // e.g. "OANDA:XAU_USD"
    if (display && sym) {
      const compact = display.replace(/[^A-Z0-9]/g, ''); // "XAUUSD"
      if (compact && !map[compact]) map[compact] = sym;
    }
  }

  storage.setJSON(FOREX_MAP_KEY, { fetchedAtMs: Date.now(), map });
  return map;
}

async function resolveSymbolSpec(spec, tabId) {
  if (spec.type !== 'forex') return spec;

  const raw = String(spec.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const forexMap = await getForexMap();

  const resolved = forexMap[raw];
  if (!resolved) {
    // Keep raw; the request will likely fail, but the error path can show a hint in UI.
    return { ...spec, resolvedSymbol: spec.symbol, cacheKey: `${spec.symbol}` };
  }

  return {
    ...spec,
    resolvedSymbol: resolved,          // the actual Finnhub forex symbol
    cacheKey: resolved                 // stabilize caching
  };
}

async function fetchBase1m(tabId, spec) {
  const symbol = spec.type === 'forex' ? (spec.resolvedSymbol || spec.symbol) : spec.symbol;
  const to = nowSec();
  const from = to - 7 * 24 * 3600; // enough to cover last weekday session even across weekends

  const json =
    spec.type === 'forex'
      ? await apiClient.forexCandles({ symbol, resolution: '1', from, to, keyName: tabId })
      : await apiClient.stockCandles({ symbol, resolution: '1', from, to, keyName: tabId });

  let candles = parseFinnhubCandleResponse(json);
  candles = filterWeekdaysOnly(candles);
  return candles;
}

async function fetchBase1h30d(tabId, spec) {
  const symbol = spec.type === 'forex' ? (spec.resolvedSymbol || spec.symbol) : spec.symbol;
  const to = nowSec();
  const from = to - 45 * 24 * 3600; // buffer

  const json =
    spec.type === 'forex'
      ? await apiClient.forexCandles({ symbol, resolution: '60', from, to, keyName: tabId })
      : await apiClient.stockCandles({ symbol, resolution: '60', from, to, keyName: tabId });

  let candles = parseFinnhubCandleResponse(json);
  candles = filterWeekdaysOnly(candles);
  return candles;
}

function computeChangePct(candles) {
  if (!candles?.length) return null;
  const first = candles[0];
  const last = candles[candles.length - 1];
  if (!first?.o || !last?.c) return null;
  const pct = ((last.c - first.o) / first.o) * 100;
  return Number.isFinite(pct) ? pct : null;
}

function lastPrice(candles) {
  if (!candles?.length) return null;
  const last = candles[candles.length - 1];
  return last?.c ?? null;
}

async function buildDerivedSets(tabId, spec, base1m, base1h) {
  // 1D: last 1 weekday “session” from 1m
  const d1 = pickLastNDays(base1m, 1);

  // 1W: last 5 weekdays from 1h
  const w1 = pickLastNDays(base1h, 5);

  // 1M: last 21 weekdays from 1h, aggregated to 4h
  const m1h = pickLastNDays(base1h, 21);
  const m4 = aggregateTo4h(m1h);

  return { d1, w1, m4 };
}

async function prefetchSymbol(tabId, symbolSpec, opts = {}) {
  const resolvedSpec = await resolveSymbolSpec(symbolSpec, tabId);
  const symbolKey = normalizeSymbolKey(resolvedSpec);

  const base1mSlot = 'BASE_1M';
  const base1hSlot = 'BASE_1H_30D';
  const d1Slot = 'DERIVED_1D';
  const w1Slot = 'DERIVED_1W';
  const m1Slot = 'DERIVED_1M_4H';

  const base1mCache = readCache(tabId, symbolKey, base1mSlot);
  const base1hCache = readCache(tabId, symbolKey, base1hSlot);

  const need1m = !base1mCache || isStale(base1mCache, STALE_MS['1D']);
  const need1h = !base1hCache || isStale(base1hCache, STALE_MS['1H_BASE']);

  const inflightKey = `${tabId}:${symbolKey}:prefetch`;

  if (inflight.has(inflightKey)) return inflight.get(inflightKey);

  const task = (async () => {
    let base1m = base1mCache?.candles || [];
    let base1h = base1hCache?.candles || [];

    // Fetch bases (in parallel) only if needed
    const [r1m, r1h] = await Promise.allSettled([
      need1m ? fetchBase1m(tabId, resolvedSpec) : Promise.resolve(base1m),
      need1h ? fetchBase1h30d(tabId, resolvedSpec) : Promise.resolve(base1h)
    ]);

    if (r1m.status === 'fulfilled') base1m = r1m.value;
    if (r1h.status === 'fulfilled') base1h = r1h.value;

    // Fallback handling (e.g., DXY -> UUP) could be layered here:
    // if empty + spec.fallback -> retry once with fallback.

    const fetchedAtMs = Date.now();

    if (need1m && base1m.length) {
      writeCache(tabId, symbolKey, base1mSlot, {
        fetchedAtMs,
        candles: base1m,
        meta: { type: resolvedSpec.type, symbol: resolvedSpec.symbol, resolvedSymbol: resolvedSpec.resolvedSymbol }
      });
    }

    if (need1h && base1h.length) {
      writeCache(tabId, symbolKey, base1hSlot, {
        fetchedAtMs,
        candles: base1h,
        meta: { type: resolvedSpec.type, symbol: resolvedSpec.symbol, resolvedSymbol: resolvedSpec.resolvedSymbol }
      });
    }

    const { d1, w1, m4 } = await buildDerivedSets(tabId, resolvedSpec, base1m, base1h);

    // Derived sets are always written (cheap, ensures instant toggles)
    writeCache(tabId, symbolKey, d1Slot, { fetchedAtMs, candles: d1, meta: { derivedFrom: base1mSlot } });
    writeCache(tabId, symbolKey, w1Slot, { fetchedAtMs, candles: w1, meta: { derivedFrom: base1hSlot } });
    writeCache(tabId, symbolKey, m1Slot, { fetchedAtMs, candles: m4, meta: { derivedFrom: base1hSlot, agg: '4h' } });

    return true;
  })().finally(() => {
    inflight.delete(inflightKey);
  });

  inflight.set(inflightKey, task);
  return task;
}

function getDerivedSlot(timeframe) {
  if (timeframe === TIMEFRAMES.ONE_DAY) return 'DERIVED_1D';
  if (timeframe === TIMEFRAMES.ONE_WEEK) return 'DERIVED_1W';
  return 'DERIVED_1M_4H';
}

export const candleService = {
  /**
   * Prefetch all symbols for a tab (Global/Metals/Commo/Rates)
   * - grabs 1m session + 1h(30D)
   * - derives 1D/1W/1M instantly
   */
  async prefetchTab(tabId, opts = {}) {
    const tab = macroConfig.tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== 'macro') return;

    // Resolve + fetch each symbol. Keep concurrency limited (per-key queue already helps).
    const symbols = tab.symbols || [];
    const batches = [];
    const CONCURRENCY = 4;

    for (let i = 0; i < symbols.length; i += CONCURRENCY) {
      batches.push(symbols.slice(i, i + CONCURRENCY));
    }

    for (const batch of batches) {
      await Promise.allSettled(batch.map((spec) => prefetchSymbol(tabId, spec, opts)));
    }

    // Track per-tab lastUpdated
    storage.setJSON(`${CACHE_PREFIX}:${tabId}:lastUpdated`, {
      fetchedAtMs: Date.now(),
      reason: opts.reason || 'auto'
    });
  },

  getTabLastUpdatedMs(tabId) {
    const snap = storage.getJSON(`${CACHE_PREFIX}:${tabId}:lastUpdated`);
    return snap?.fetchedAtMs || null;
  },

  /**
   * For tiles: last price + change% for selected timeframe, and candles for mini viz if needed.
   */
  getSnapshot(tabId, symbolSpec, timeframe) {
    const symbolKey = normalizeSymbolKey(symbolSpec);
    const slot = getDerivedSlot(timeframe);
    const entry = readCache(tabId, symbolKey, slot);

    const candles = entry?.candles || [];
    return {
      symbol: symbolSpec.symbol,
      last: lastPrice(candles),
      changePct: computeChangePct(candles),
      candles,
      fetchedAtMs: entry?.fetchedAtMs || null
    };
  },

  /**
   * For expanded tile: reuse the exact cached candles (no extra calls).
   */
  getCandles(tabId, symbolSpec, timeframe) {
    const symbolKey = normalizeSymbolKey(symbolSpec);
    const slot = getDerivedSlot(timeframe);
    const entry = readCache(tabId, symbolKey, slot);
    return entry?.candles || [];
  }
};
