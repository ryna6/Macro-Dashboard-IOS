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
//
// Sparkline source (important):
// - The overview sparkline is NOT from candles. It’s built from periodic quote refreshes.
// - To avoid “flat overnight” segments, we only record and display points during the regular session window
//   (default 09:00–16:30 America/New_York).

import { apiClient } from './apiClient.js';
import { storage } from './storage.js';
import { TIMEFRAMES } from './candleService.js';
import { rangeChangeService } from './rangeChangeService.js';
import { nyTime } from './time.js';

const QUOTE_CACHE_PREFIX = 'macrodb:quotes:v1:'; // + tabId

// Staleness
const QUOTE_TTL_MS = 2 * 60 * 1000; // quote refresh interval tolerance

// Small in-memory sparkline built from quote refreshes
// NOTE: 09:00–16:30 is 450 minutes. At 5-min cadence that’s ~90 pts; at 2-min cadence ~225 pts.
const SPARK_MAX_POINTS = 260;

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

// ─────────────────────────────────────────────────────────────────────────────
// Market session window helpers (America/New_York)
// Defaults are intentionally “wider” than 09:30–16:00 so you can include a bit of pre/post if desired.
// You requested ~09:00–16:30.
// ─────────────────────────────────────────────────────────────────────────────

const SESSION_START = { hour: 9, minute: 0 };
const SESSION_END = { hour: 16, minute: 30 };

function sessionBoundsForYmd(ymd) {
  // ymd = "YYYY-MM-DD"
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return { startMs: 0, endMs: 0 };
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);

  const startSec = nyTime.zonedToUtcSec({
    year,
    month,
    day,
    hour: SESSION_START.hour,
    minute: SESSION_START.minute,
    second: 0
  });

  const endSec = nyTime.zonedToUtcSec({
    year,
    month,
    day,
    hour: SESSION_END.hour,
    minute: SESSION_END.minute,
    second: 0
  });

  return { startMs: startSec * 1000, endMs: endSec * 1000 };
}

function isInSessionMs(ms) {
  const tSec = Math.floor(ms / 1000);
  const ymd = nyTime.ymd(tSec);
  const { startMs, endMs } = sessionBoundsForYmd(ymd);
  return ms >= startMs && ms <= endMs;
}

function filterSparkToMostRecentSession(spark) {
  if (!Array.isArray(spark) || spark.length < 2) return Array.isArray(spark) ? spark : [];

  const last = spark[spark.length - 1];
  const lastSec = Math.floor((last?.t || 0) / 1000);
  const ymd = nyTime.ymd(lastSec);
  const { startMs, endMs } = sessionBoundsForYmd(ymd);

  const filtered = spark.filter((p) => {
    const t = p?.t || 0;
    return t >= startMs && t <= endMs;
  });

  // Keep the newest N points (storage protection)
  return filtered.length > SPARK_MAX_POINTS ? filtered.slice(-SPARK_MAX_POINTS) : filtered;
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

    // Sparkline: show only the most recent session window to avoid “overnight flat”
    const sparkRaw = Array.isArray(rec?.spark) ? rec.spark : [];
    const spark = filterSparkToMostRecentSession(sparkRaw);

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

      // Sparkline recording policy:
      // - Record points ONLY during the regular session window (09:00–16:30 ET)
      // - Reset the series when a new session day begins (but only when we are IN session)
      const inSession = isInSessionMs(existing.updatedMs);

      existing.spark ||= [];

      if (inSession) {
        // If we have points from a prior day/session, reset when the new session starts.
        if (existing.spark.length) {
          const lastPt = existing.spark[existing.spark.length - 1];
          const lastSec = Math.floor((lastPt?.t || 0) / 1000);
          const lastYmd = nyTime.ymd(lastSec);

          const curSec = Math.floor(existing.updatedMs / 1000);
          const curYmd = nyTime.ymd(curSec);

          if (lastYmd !== curYmd) existing.spark = [];
        }

        existing.spark.push({ t: existing.updatedMs, c: q.c });
        if (existing.spark.length > SPARK_MAX_POINTS) existing.spark = existing.spark.slice(-SPARK_MAX_POINTS);
      } else {
        // Outside session: do NOT append new points (prevents “overnight flat”).
        // We still keep whatever the most recent session series was, so the tile has a meaningful line.
      }

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
