// src/data/quoteService.js
//
// Overview tiles use QUOTES for last price + 1D change.
// Sparkline uses TwelveData intraday time_series cached by intradayService.
//
// % change by timeframe:
// - 1D: Finnhub quote dp/pc when available.
// - 1W/1M: computed via rangeChangeService baselines (daily series).

import { apiClient } from './apiClient.js';
import { storage } from './storage.js';
import { TIMEFRAMES } from './candleService.js';
import { rangeChangeService } from './rangeChangeService.js';
import { intradayService } from './intradayService.js';

const QUOTE_CACHE_PREFIX = 'macrodb:quotes:v1:'; // + tabId
const QUOTE_TTL_MS = 2 * 60 * 1000;
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
  if (spec?.logoUrl) return spec.logoUrl;
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

// ✅ FIX: intradayService caches "candles", not "bars"
function sparkFromIntradayCache(tabId, symbol) {
  const cached = intradayService.getCached(tabId, symbol, '1D');
  const arr = cached?.candles || cached?.bars || [];
  if (!Array.isArray(arr) || arr.length < 2) return [];
  return arr.map((b) => ({ t: b.t, c: b.c }));
}

export const quoteService = {
  TIMEFRAMES,

  getTabLastUpdatedMs(tabId) {
    return loadTabDisk(tabId)?.lastUpdatedMs || 0;
  },

  isTimeframeEnabled(tabId, tf) {
    return rangeChangeService.isTimeframeEnabled(tabId, tf);
  },

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
        if (isFiniteNum(q?.dp)) changePct = q.dp;
        else if (isFiniteNum(q?.pc) && q.pc !== 0) changePct = pctChange(q.pc, last);
      } else if (timeframe === TIMEFRAMES.ONE_WEEK || timeframe === TIMEFRAMES.ONE_MONTH) {
        const baseline = rangeChangeService.getBaselineClose(tabId, spec, timeframe);
        if (baseline != null) changePct = pctChange(baseline, last);
      }
    }

    const spark = sparkFromIntradayCache(tabId, spec.symbol);

    return {
      last,
      changePct,
      spark,
      logoUrl: fixedLogoUrl(spec)
    };
  },

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
          updatedMs: 0
        };

      const age = nowMs() - (existing.updatedMs || 0);
      if (!force && existing.updatedMs && age < QUOTE_TTL_MS) return false;

      const candidates = [spec.symbol];
      if (spec.fallback) candidates.push(spec.fallback);

      let usedSymbol = null;
      let q = null;

      for (const sym of candidates) {
        try {
          const res = await apiClient.quote({ keyName: tabId, symbol: sym });
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

      writeSymbol(tabId, key, existing);
      return true;
    })().finally(() => {
      inflight.delete(inflightKey);
    });

    inflight.set(inflightKey, p);
    return p;
  },

  async prefetchTab(tabId, specs, { force = false } = {}) {
    const list = Array.isArray(specs) ? specs : [];
    for (let i = 0; i < list.length; i++) {
      await this.ensureFreshSymbol(tabId, list[i], { force });
      if (i < list.length - 1) await sleep(REQUEST_SPACING_MS);
    }
  }
};

function writeSymbol(tabId, key, rec) {
  getTabMem(tabId).set(key, rec);

  const disk = loadTabDisk(tabId);
  disk.symbols ||= {};
  disk.symbols[key] = {
    type: rec.type,
    symbol: rec.symbol,
    resolvedSymbol: rec.resolvedSymbol || null,
    last: rec.last,
    quote: rec.quote || null,
    updatedMs: rec.updatedMs || 0
  };
  disk.lastUpdatedMs = Math.max(disk.lastUpdatedMs || 0, rec.updatedMs || 0);
  saveTabDisk(tabId, disk);
}
