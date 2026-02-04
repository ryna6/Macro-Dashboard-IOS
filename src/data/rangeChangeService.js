// src/data/rangeChangeService.js
//
// Computes 1W / 1M % change using DAILY candles when available.
//
// Why this exists:
// - Finnhub /quote only provides 1D change (dp/pc).
// - For 1W/1M, we need historical closes.
// - On some free plans, /stock/candle may be blocked (403). If that happens, we
//   back off and disable 1W/1M for a cooldown period to avoid request spam.

import { apiClient } from './apiClient.js';
import { storage } from './storage.js';
import { TIMEFRAMES } from './candleService.js';

const CACHE_PREFIX = 'macrodb:ranges:v1:'; // + tabId

// Baselines don't need to be super fresh; daily is fine.
const BASELINE_TTL_MS = 12 * 60 * 60 * 1000; // 12h

// If Finnhub blocks candles (403), stop trying for a while.
const BLOCK_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h

// Light spacing between symbols to avoid burst rate-limits.
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
      blockedUntilMs: 0,
      lastError: null
    }
  );
}

function save(tabId, obj) {
  storage.setJSON(`${CACHE_PREFIX}${tabId}`, obj);
}

function is403(err) {
  const status = err?.status;
  if (status === 403) return true;
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('403') || msg.includes('access') || msg.includes('forbidden') || msg.includes('premium');
}

function pickEndpoint(spec) {
  // This repo supports both stock and forex candles via apiClient.
  // Most of your symbols are ETFs/stocks, so default to stockCandles.
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
  const last = n ? closes[n - 1] : null;

  // 5 trading sessions ago (approx 1W)
  const w = n >= 6 ? closes[n - 6] : null;

  // ~21 trading sessions ago (approx 1M)
  const m = n >= 22 ? closes[n - 22] : null;

  return { lastClose: last, weekClose: w, monthClose: m };
}

async function fetchDailyCandles(tabId, spec) {
  // pull ~3 months to ensure we have enough points for 1M even with holidays
  const to = nowSec();
  const from = to - 90 * 24 * 60 * 60;

  const endpoint = pickEndpoint(spec);
  if (endpoint === 'forex') {
    return apiClient.forexCandles({
      keyName: tabId,
      symbol: spec.symbol,
      resolution: 'D',
      from,
      to
    });
  }

  return apiClient.stockCandles({
    keyName: tabId,
    symbol: spec.symbol,
    resolution: 'D',
    from,
    to
  });
}

export const rangeChangeService = {
  TIMEFRAMES,

  isBlocked(tabId) {
    const disk = load(tabId);
    return (disk.blockedUntilMs || 0) > nowMs();
  },

  // Returns true if the timeframe can be attempted (not in cooldown).
  isTimeframeEnabled(tabId, tf) {
    if (tf === TIMEFRAMES.ONE_DAY) return true;
    return !this.isBlocked(tabId);
  },

  // Returns baseline close for the timeframe (or null).
  getBaselineClose(tabId, spec, tf) {
    if (tf === TIMEFRAMES.ONE_DAY) return null;
    const disk = load(tabId);
    const key = symbolKey(spec);
    const rec = disk.baselines?.[key] || null;

    if (tf === TIMEFRAMES.ONE_WEEK) return rec?.['1W'] ?? null;
    if (tf === TIMEFRAMES.ONE_MONTH) return rec?.['1M'] ?? null;
    return null;
  },

  // Ensure baselines exist (best-effort). Returns true if baselines should be usable.
  async ensureBaselinesForTab(tabId, specs, { force = false } = {}) {
    const disk = load(tabId);

    // Cooldown guard
    if ((disk.blockedUntilMs || 0) > nowMs()) return false;

    const age = nowMs() - (disk.fetchedAtMs || 0);
    if (!force && disk.fetchedAtMs && age < BASELINE_TTL_MS) return true;

    const list = Array.isArray(specs) ? specs : [];

    try {
      const next = {
        ...disk,
        baselines: { ...(disk.baselines || {}) },
        lastError: null
      };

      for (let i = 0; i < list.length; i++) {
        const spec = list[i];
        const key = symbolKey(spec);

        try {
          const json = await fetchDailyCandles(tabId, spec);
          const closes = parseCloses(json);
          const { weekClose, monthClose } = computeBaselinesFromCloses(closes);

          next.baselines[key] = {
            '1W': weekClose ?? null,
            '1M': monthClose ?? null
          };
        } catch (err) {
          // If any symbol hard-fails with a 403, assume plan restriction and back off.
          if (is403(err)) throw err;

          // Otherwise, just skip this symbol.
          next.baselines[key] = next.baselines[key] || { '1W': null, '1M': null };
        }

        if (i < list.length - 1) await sleep(REQUEST_SPACING_MS);
      }

      next.fetchedAtMs = nowMs();
      save(tabId, next);
      return true;
    } catch (err) {
      const blockedUntilMs = nowMs() + BLOCK_COOLDOWN_MS;
      save(tabId, {
        ...disk,
        blockedUntilMs,
        lastError: String(err?.message || err || 'Blocked')
      });
      return false;
    }
  }
};
