import { apiClient } from './apiClient.js';
import { macroConfig } from './macroConfig.js';
import { storage } from './storage.js';
import { nyTime } from './time.js';

export const TIMEFRAMES = {
  ONE_DAY: '1D',
  ONE_WEEK: '1W',
  ONE_MONTH: '1M'
};

const CACHE_PREFIX = 'md_macro_candles_v1';

const STALE_MS = {
  '1D': 2.5 * 60 * 1000,
  '1H_BASE': 15 * 60 * 1000
};

const mem = new Map();
const inflight = new Map();

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
  if (persisted?.candles && persisted.fetchedAtMs) {
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

function filterWeekdaysOnly(candles) {
  return candles.filter((x) => !nyTime.isWeekend(x.t));
}

function pickLastNDays(candles, nDays) {
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
  return candles.filter((x) => allowed.has(nyTime.ymd(x.t)));
}

function aggregateTo4h(candles1h) {
  if (!candles1h.length) return [];
  const groups = new Map();

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

  return Array.from(groups.values()).sort((a, b) => a.t - b.t);
}

// Forex map (one-time discovery)
const FOREX_MAP_KEY = 'md_macro_forex_map_v1';

async function getForexMap() {
  const cached = storage.getJSON(FOREX_MAP_KEY);
  if (cached?.map && cached?.fetchedAtMs && Date.now() - cached.fetchedAtMs < 30 * 24 * 60 * 60 * 1000) {
    return cached.map;
  }

  const list = await apiClient.forexSymbols({ exchange: 'OANDA', keyName: 'metals' });

  const map = {};
  for (const row of Array.isArray(list) ? list : []) {
    const display = String(row.displaySymbol || '').toUpperCase(); // XAU/USD
    const sym = String(row.symbol || '').toUpperCase();           // OANDA:XAU_USD
    if (display && sym) {
      const compact = display.replace(/[^A-Z0-9]/g, ''); // XAUUSD
      if (compact && !map[compact]) map[compact] = sym;
    }
  }

  storage.setJSON(FOREX_MAP_KEY, { fetchedAtMs: Date.now(), map });
  return map;
}

async function resolveSymbolSpec(spec) {
  if (spec.type !== 'forex') return spec;

  const raw = String(spec.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const forexMap = await getForexMap();
  const resolved = forexMap[raw];

  return {
    ...spec,
    resolvedSymbol: resolved || spec.symbol,
    cacheKey: (resolved || spec.symbol || '').toUpperCase()
  };
}

function resolveReadKey(spec) {
  if (spec.type !== 'forex') return (spec.symbol || '').toUpperCase();

  const raw = String(spec.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const cached = storage.getJSON(FOREX_MAP_KEY);
  const resolved = cached?.map?.[raw];
  return (resolved || spec.symbol || '').toUpperCase();
}

async function fetchBase1m(tabId, spec) {
  const symbol = spec.type === 'forex' ? (spec.resolvedSymbol || spec.symbol) : spec.symbol;
  const to = nowSec();
  const from = to - 7 * 24 * 3600;

  const json =
    spec.type === 'forex'
      ? await apiClient.forexCandles({ symbol, resolution: '1', from, to, keyName: tabId })
      : await apiClient.stockCandles({ symbol, resolution: '1', from, to, keyName: tabId });

  return filterWeekdaysOnly(parseFinnhubCandleResponse(json));
}

async function fetchBase1h30d(tabId, spec) {
  const symbol = spec.type === 'forex' ? (spec.resolvedSymbol || spec.symbol) : spec.symbol;
  const to = nowSec();
  const from = to - 45 * 24 * 3600;

  const json =
    spec.type === 'forex'
      ? await apiClient.forexCandles({ symbol, resolution: '60', from, to, keyName: tabId })
      : await apiClient.stockCandles({ symbol, resolution: '60', from, to, keyName: tabId });

  return filterWeekdaysOnly(parseFinnhubCandleResponse(json));
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
  return candles[candles.length - 1]?.c ?? null;
}

function getDerivedSlot(timeframe) {
  if (timeframe === TIMEFRAMES.ONE_DAY) return 'DERIVED_1D';
  if (timeframe === TIMEFRAMES.ONE_WEEK) return 'DERIVED_1W';
  return 'DERIVED_1M_4H';
}

async function prefetchSymbol(tabId, symbolSpec, opts = {}) {
  const resolvedSpec = await resolveSymbolSpec(symbolSpec);
  const symbolKey = (resolvedSpec.cacheKey || resolvedSpec.symbol || '').toUpperCase();

  const base1mSlot = 'BASE_1M';
  const base1hSlot = 'BASE_1H_30D';
  const d1Slot = 'DERIVED_1D';
  const w1Slot = 'DERIVED_1W';
  const m1Slot = 'DERIVED_1M_4H';

  const base1mCache = readCache(tabId, symbolKey, base1mSlot);
  const base1hCache = readCache(tabId, symbolKey, base1hSlot);

  const force = !!opts.force;
  const need1m = force || !base1mCache || isStale(base1mCache, STALE_MS['1D']);
  const need1h = force || !base1hCache || isStale(base1hCache, STALE_MS['1H_BASE']);

  const inflightKey = `${tabId}:${symbolKey}:prefetch`;
  if (inflight.has(inflightKey)) return inflight.get(inflightKey);

  const task = (async () => {
    let base1m = base1mCache?.candles || [];
    let base1h = base1hCache?.candles || [];

    async function tryFetchWithFallback(fetchFn, spec) {
      try {
        return await fetchFn(tabId, spec);
      } catch (e) {
        if (spec.fallback) {
          const fallbackSpec = { ...spec, type: 'stock', symbol: spec.fallback, cacheKey: spec.fallback };
          return await fetchFn(tabId, fallbackSpec);
        }
        throw e;
      }
    }

    const [r1m, r1h] = await Promise.allSettled([
      need1m ? tryFetchWithFallback(fetchBase1m, resolvedSpec) : Promise.resolve(base1m),
      need1h ? tryFetchWithFallback(fetchBase1h30d, resolvedSpec) : Promise.resolve(base1h)
    ]);

    if (r1m.status === 'fulfilled') base1m = r1m.value;
    if (r1h.status === 'fulfilled') base1h = r1h.value;

    const fetchedAtMs = Date.now();

    if (need1m && base1m.length) {
      writeCache(tabId, symbolKey, base1mSlot, { fetchedAtMs, candles: base1m });
    }
    if (need1h && base1h.length) {
      writeCache(tabId, symbolKey, base1hSlot, { fetchedAtMs, candles: base1h });
    }

    const d1 = pickLastNDays(base1m, 1);
    const w1 = pickLastNDays(base1h, 5);
    const m1h = pickLastNDays(base1h, 21);
    const m4 = aggregateTo4h(m1h);

    writeCache(tabId, symbolKey, d1Slot, { fetchedAtMs, candles: d1 });
    writeCache(tabId, symbolKey, w1Slot, { fetchedAtMs, candles: w1 });
    writeCache(tabId, symbolKey, m1Slot, { fetchedAtMs, candles: m4 });

    return true;
  })().finally(() => inflight.delete(inflightKey));

  inflight.set(inflightKey, task);
  return task;
}

export const candleService = {
  async prefetchTab(tabId, opts = {}) {
    const tab = macroConfig.tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== 'macro') return;

    const symbols = tab.symbols || [];
    const CONCURRENCY = 4;

    for (let i = 0; i < symbols.length; i += CONCURRENCY) {
      const batch = symbols.slice(i, i + CONCURRENCY);
      await Promise.allSettled(batch.map((spec) => prefetchSymbol(tabId, spec, opts)));
    }

    storage.setJSON(`${CACHE_PREFIX}:${tabId}:lastUpdated`, {
      fetchedAtMs: Date.now(),
      reason: opts.reason || 'auto'
    });
  },

  getTabLastUpdatedMs(tabId) {
    const snap = storage.getJSON(`${CACHE_PREFIX}:${tabId}:lastUpdated`);
    return snap?.fetchedAtMs || null;
  },

  getSnapshot(tabId, symbolSpec, timeframe) {
    const symbolKey = resolveReadKey(symbolSpec);
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

  getCandles(tabId, symbolSpec, timeframe) {
    const symbolKey = resolveReadKey(symbolSpec);
    const slot = getDerivedSlot(timeframe);
    const entry = readCache(tabId, symbolKey, slot);
    return entry?.candles || [];
  }
};