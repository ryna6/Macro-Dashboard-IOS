// src/data/quoteService.js
//
// Overview tiles use QUOTES (not candles) so the app works on plans where intraday candles are restricted.
// - Stocks/ETFs: /quote
// - Logos: LOCAL ONLY from /public/icons/symbols/<SYMBOL>.png (or spec.logoUrl if provided)
//
// % change by timeframe:
// - 1D: from Finnhub quote dp/pc when available.
// - 1W/1M: computed from DAILY candle baselines when available (see rangeChangeService).
//   If candles are blocked on your plan, 1W/1M will be disabled automatically (cooldown) to avoid spam.

import { apiClient } from './apiClient.js';
import { storage } from './storage.js';
import { TIMEFRAMES } from './candleService.js';
import { rangeChangeService } from './rangeChangeService.js';

const QUOTE_CACHE_PREFIX = 'macrodb:quotes:v1:'; // + tabId

// Staleness
const QUOTE_TTL_MS = 2 * 60 * 1000; // quote refresh interval tolerance

// Small in-memory sparkline built from quote refreshes
const SPARK_MAX_POINTS = 40;

// Light rate-limit spacing when prefetching whole tabs
const REQUEST_SPACING_MS = 120;

const memTabs = new Map(); // tabId -> Map(symbolKey -> record)
const inflight = new Map(); // `${tabId}:${symbolKey}` -> Promise<boolean>

function nowMs() {
  return Date.now();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isFiniteNum(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

function symbolKey(spec) {
  const type = spec?.type || 'stock';
  return `${type}:${String(spec?.symbol || '').toUpperCase()}`;
}

function fixedLogoUrl(spec) {
  if (spec?.logoUrl) return spec.logoUrl; // allow override in macroConfig if desired
  const sym = String(spec?.symbol || '').toUpperCase();
  return sym ? `/icons/symbols/${sym}.png` : null;
}

function loadTabDisk(tabId) {
  return storage.getJSON(`${QUOTE_CACHE_PREFIX}${tabId}`) || { symbols: {}, lastUpdatedMs: 0 };
}

function saveTabDisk(tabId, obj) {
  storage.setJSON(`${QUOTE_CACHE_PREFIX}${tabId}`, obj);
}

function getTabMem(tabId) {
  if (!memTabs.has(tabId)) memTabs.set(tabId, new Map());
  return memTabs.get(tabId);
}

function mergeDiskIntoMem(tabId) {
  const disk = loadTabDisk(tabId);
  const m = getTabMem(tabId);
  for (const [k, v] of Object.entries(disk.symbols || {})) {
    if (!m.has(k)) m.set(k, v);
  }
}

function pctChange(from, to) {
  if (!isFiniteNum(from) || !isFiniteNum(to) || from === 0) return null;
  return ((to - from) / from) * 100;
}

export const quoteService = {
  TIMEFRAMES,

  getTabLastUpdatedMs(tabId) {
    return loadTabDisk(tabId)?.lastUpdatedMs || 0;
  },

  // For UI enabling/disabling 1W/1M options.
  isTimeframeEnabled(tabId, tf) {
    return rangeChangeService.isTimeframeEnabled(tabId, tf);
  },

  // Best-effort: fetch daily baselines for 1W/1M change.
  async ensureRangeBaselines(tabId, specs, { force = false } = {}) {
    return rangeChangeService.ensureBaselinesForTab(tabId, specs, { force });
  },

  getSnapshot(tabId, spec, timeframe) {
    mergeDiskIntoMem(tabId);

    const key = symbolKey(spec);
    const rec = getTabMem(tabId).get(key);

    const last = isFiniteNum(rec?.last) ? rec.last : null;
    const q = rec?.quote || null;

    let changePct = null;

    if (last != null) {
      if (timeframe === TIMEFRAMES.ONE_DAY) {
        // 1D: use Finnhub quote dp/pc when available
        if (isFiniteNum(q?.dp)) changePct = q.dp;
        else if (isFiniteNum(q?.pc) && q.pc !== 0) changePct = pctChange(q.pc, last);
      } else if (timeframe === TIMEFRAMES.ONE_WEEK || timeframe === TIMEFRAMES.ONE_MONTH) {
        const baseline = rangeChangeService.getBaselineClose(tabId, spec, timeframe);
        if (baseline != null) changePct = pctChange(baseline, last);
      }
    }

    const spark = Array.isArray(rec?.spark) ? rec.spark : [];

    return {
      last,
      changePct,
      spark,
      // Always point at local icon path (or config override)
      logoUrl: fixedLogoUrl(spec)
    };
  },

  // Fetch quote. Returns true if record updated.
  async ensureFreshSymbol(tabId, spec, { force = false } = {}) {
    const key = symbolKey(spec);
    const inflightKey = `${tabId}:${key}`;
    if (inflight.has(inflightKey)) return inflight.get(inflightKey);

    const p = (async () => {
      mergeDiskIntoMem(tabId);

      const m = getTabMem(tabId);
      const disk = loadTabDisk(tabId);

      const existing =
        m.get(key) ||
        disk.symbols?.[key] ||
        {
          type: spec?.type || 'stock',
          symbol: String(spec?.symbol || '').toUpperCase(),
          last: null,
          quote: null,
          updatedMs: 0,
          spark: []
        };

      const age = nowMs() - (existing.updatedMs || 0);
      if (!force && existing.updatedMs && age < QUOTE_TTL_MS) {
        // no refetch
        return false;
      }

      // Stocks/ETFs via /quote (+ optional fallback symbol)
      const candidates = [spec.symbol];
      if (spec.fallback) candidates.push(spec.fallback);

      let usedSymbol = null;
      let q = null;

      for (const sym of candidates) {
        try {
          const res = await apiClient.quote({ keyName: tabId, symbol: sym });
          // Finnhub sometimes returns 0 for invalid symbol; treat as invalid
          if (res && isFiniteNum(res.c) && res.c !== 0) {
            usedSymbol = String(sym).toUpperCase();
            q = res;
            break;
          }
        } catch {
          // continue
        }
      }

      if (!q || !usedSymbol) return false;

      existing.type = spec?.type || 'stock';
      existing.symbol = String(spec?.symbol || '').toUpperCase();
      existing.resolvedSymbol = usedSymbol;
      existing.quote = q;
      existing.last = q.c;
      existing.updatedMs = nowMs();

      existing.spark ||= [];
      existing.spark.push({ t: existing.updatedMs, c: q.c });
      if (existing.spark.length > SPARK_MAX_POINTS) existing.spark = existing.spark.slice(-SPARK_MAX_POINTS);

      writeSymbol(tabId, key, existing);
      return true;
    })().finally(() => {
      inflight.delete(inflightKey);
    });

    inflight.set(inflightKey, p);
    return p;
  },

  // Used by header refresh + auto refresh
  async prefetchTab(tabId, specs, { force = false } = {}) {
    const list = Array.isArray(specs) ? specs : [];
    for (let i = 0; i < list.length; i++) {
      await this.ensureFreshSymbol(tabId, list[i], { force });
      if (i < list.length - 1) await sleep(REQUEST_SPACING_MS);
    }
  }
};

function writeSymbol(tabId, key, rec) {
  // mem
  getTabMem(tabId).set(key, rec);

  // disk
  const disk = loadTabDisk(tabId);
  disk.symbols ||= {};
  disk.symbols[key] = {
    type: rec.type,
    symbol: rec.symbol,
    resolvedSymbol: rec.resolvedSymbol || null,
    last: rec.last,
    quote: rec.quote || null,
    updatedMs: rec.updatedMs || 0,
    spark: Array.isArray(rec.spark) ? rec.spark.slice(-SPARK_MAX_POINTS) : []
  };
  disk.lastUpdatedMs = Math.max(disk.lastUpdatedMs || 0, rec.updatedMs || 0);
  saveTabDisk(tabId, disk);
}
