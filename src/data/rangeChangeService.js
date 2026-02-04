// src/data/rangeChangeService.js
//
// Computes 1W / 1M % change using DAILY closes.
// Primary attempt: Finnhub daily candles
// Fallback: Twelve Data daily time_series
//
// Important change: we do NOT hard-disable 1W/1M via cooldown anymore.
// If some symbols fail, we keep timeframes enabled and return null baselines for those symbols.

import { apiClient } from './apiClient.js';
import { twelveDataClient } from './twelveDataClient.js';
import { storage } from './storage.js';
import { TIMEFRAMES } from './candleService.js';

const CACHE_PREFIX = 'macrodb:ranges:v1:'; // + tabId
const BASELINE_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const REQUEST_SPACING_MS = 120;

function nowMs() {
  return Date.now();
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function symbolKey(spec) {
  const type = spec?.type || 'stock';
  return `${type}:${String(spec?.symbol || '').toUpperCase()}`;
}

function load(tabId) {
  return (
    storage.getJSON(`${CACHE_PREFIX}${tabId}`) || {
      baselines: {}, // key -> { '1W': number|null, '1M': number|null }
      fetchedAtMs: 0,
      lastError: null
    }
  );
}

function save(tabId, obj) {
  storage.setJSON(`${CACHE_PREFIX}${tabId}`, obj);
}

function pickEndpoint(spec) {
  if (String(spec?.type || '').toLowerCase() === 'forex') return 'forex';
  return 'stock';
}

function parseCloses(json) {
  if (!json || json.s !== 'ok') return [];
  const c = Array.isArray(json.c) ? json.c : [];
  return c.filter((x) => typeof x === 'number' && Number.isFinite(x));
}

function computeBaselinesFromCloses(closes) {
  const n = closes.length;
  const w = n >= 6 ? closes[n - 6] : null;   // ~5 trading days ago
  const m = n >= 22 ? closes[n - 22] : null; // ~21 trading days ago
  return { weekClose: w, monthClose: m };
}

function parseTwelveDataDailyToFinnhubShape(data) {
  const values = data?.values || data?.data?.values || [];
  if (!Array.isArray(values) || values.length === 0) return { s: 'no_data', c: [] };

  const rows = [];
  for (const v of values) {
    const dt = v?.datetime || v?.date || v?.timestamp;
    const t = Number.isFinite(Number(dt))
      ? Number(dt) * 1000
      : new Date(String(dt)).getTime();

    const closeNum = Number(v?.close);
    if (!Number.isFinite(closeNum)) continue;

    rows.push({ t, close: closeNum });
  }

  rows.sort((a, b) => (a.t || 0) - (b.t || 0));
  const closes = rows.map((r) => r.close);
  return { s: 'ok', c: closes };
}

async function fetchFinnhubDaily(tabId, spec) {
  const to = nowSec();
  const from = to - 120 * 24 * 60 * 60; // 120d window to comfortably cover holidays

  const endpoint = pickEndpoint(spec);
  if (endpoint === 'forex') {
    return await apiClient.forexCandles({
      keyName: tabId,
      symbol: spec.symbol,
      resolution: 'D',
      from,
      to
    });
  }

  return await apiClient.stockCandles({
    keyName: tabId,
    symbol: spec.symbol,
    resolution: 'D',
    from,
    to
  });
}

async function fetchTwelveDaily(tabId, spec) {
  const td = await twelveDataClient.timeSeries({
    keyName: tabId,
    symbol: spec.symbol,
    interval: '1day',
    outputsize: 120
  });
  return parseTwelveDataDailyToFinnhubShape(td);
}

async function fetchDailyCandles(tabId, spec) {
  // Try primary spec first, then fallback symbol if present.
  const tries = [spec];
  if (spec?.fallback) {
    tries.push({ ...spec, type: 'stock', symbol: spec.fallback });
  }

  let lastErr = null;

  for (const s of tries) {
    // 1) Finnhub attempt
    try {
      const j = await fetchFinnhubDaily(tabId, s);
      const closes = parseCloses(j);
      if (closes.length >= 22) return j;
      // If too short, fall through to TwelveData.
    } catch (e) {
      lastErr = e;
    }

    // 2) TwelveData attempt
    try {
      const j2 = await fetchTwelveDaily(tabId, s);
      const closes2 = parseCloses(j2);
      if (closes2.length >= 22) return j2;
      lastErr = new Error('Not enough daily data for baseline computation.');
    } catch (e2) {
      lastErr = e2;
    }
  }

  throw lastErr || new Error('Failed to fetch daily candles');
}

export const rangeChangeService = {
  TIMEFRAMES,

  // ✅ Never hard-disable 1W/1M; allow selection and show null baselines as "—"
  isTimeframeEnabled(tabId, tf) {
    if (tf === TIMEFRAMES.ONE_DAY) return true;
    return true;
  },

  getBaselineClose(tabId, spec, tf) {
    if (tf === TIMEFRAMES.ONE_DAY) return null;
    const disk = load(tabId);
    const key = symbolKey(spec);
    const rec = disk.baselines?.[key] || null;

    if (tf === TIMEFRAMES.ONE_WEEK) return rec?.['1W'] ?? null;
    if (tf === TIMEFRAMES.ONE_MONTH) return rec?.['1M'] ?? null;
    return null;
  },

  async ensureBaselinesForTab(tabId, specs, { force = false } = {}) {
    const disk = load(tabId);

    const age = nowMs() - (disk.fetchedAtMs || 0);
    if (!force && disk.fetchedAtMs && age < BASELINE_TTL_MS) return true;

    const list = Array.isArray(specs) ? specs : [];

    const next = {
      ...disk,
      baselines: { ...(disk.baselines || {}) },
      lastError: null
    };

    let anySuccess = false;

    for (let i = 0; i < list.length; i++) {
      const spec = list[i];
      const k = symbolKey(spec);

      try {
        const json = await fetchDailyCandles(tabId, spec);
        const closes = parseCloses(json);
        const { weekClose, monthClose } = computeBaselinesFromCloses(closes);

        next.baselines[k] = {
          '1W': weekClose ?? null,
          '1M': monthClose ?? null
        };

        if (weekClose != null || monthClose != null) anySuccess = true;
      } catch (err) {
        // Best-effort: keep existing baselines if present; otherwise set nulls.
        next.baselines[k] = next.baselines[k] || { '1W': null, '1M': null };
        next.lastError = String(err?.message || err || 'Baseline fetch failed');
      }

      if (i < list.length - 1) await sleep(REQUEST_SPACING_MS);
    }

    next.fetchedAtMs = nowMs();
    save(tabId, next);

    // ✅ Return true even if partial, to avoid UI forcing back to 1D
    return anySuccess || true;
  }
};
