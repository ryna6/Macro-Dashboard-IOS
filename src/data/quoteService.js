// src/data/quoteService.js
//
// Overview tiles use QUOTES (not candles) so the app works on plans where intraday candles are restricted.
// - Stocks/ETFs: /quote + /stock/profile2 (logo)
// - Metals spot pairs (XAUUSD, XAGUSD, XPTUSD, XPDUSD): /forex/rates (base=USD) and invert to USD-per-metal
//
// 1W/1M % change:
// - Finnhub quote does not provide 1W/1M. Without a free historical endpoint, we cannot compute it perfectly.
// - This service will show 1W/1M as "—" unless you later add a historical provider.
// - (It still keeps a small spark series from recent quote refreshes.)

import { apiClient } from './apiClient.js';
import { storage } from './storage.js';
import { nyTime } from './time.js';
import { TIMEFRAMES } from './candleService.js';

const QUOTE_CACHE_PREFIX = 'macrodb:quotes:v1:'; // + tabId
const LOGO_CACHE_KEY = 'macrodb:logos:v1';

// Staleness
const QUOTE_TTL_MS = 2 * 60 * 1000; // quote refresh interval tolerance
const FX_TTL_MS = 2 * 60 * 1000;    // forex rates refresh tolerance
const LOGO_TTL_MS = 90 * 24 * 60 * 60 * 1000; // logos basically never change

// Small in-memory sparkline built from quote refreshes
const SPARK_MAX_POINTS = 40;

const memTabs = new Map(); // tabId -> Map(symbolKey -> record)
const inflight = new Map(); // `${tabId}:${symbolKey}` -> Promise<boolean>

// FX cache per tab (USD base)
const fxMem = new Map(); // tabId -> { fetchedAtMs, ratesJson }

function nowMs() {
  return Date.now();
}

function isFiniteNum(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

function symbolKey(spec) {
  return `${spec.type}:${String(spec.symbol || '').toUpperCase()}`;
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

/* ------------------------- Logo cache (MarketDB style) ------------------------- */

let logoCache = storage.getJSON(LOGO_CACHE_KEY) || {}; // SYMBOL -> { logoUrl, lastFetchMs }

function normalizeLogoUrl(logo) {
  if (!logo) return null;
  const s = String(logo).trim();
  if (!s) return null;
  return s.startsWith('http') ? s : `https://${s.replace(/^\/+/, '')}`;
}

function getCachedLogo(symbol) {
  const sym = String(symbol || '').toUpperCase();
  const entry = logoCache[sym];
  if (!entry?.logoUrl) return null;
  if (!entry.lastFetchMs) return entry.logoUrl;
  if (nowMs() - entry.lastFetchMs > LOGO_TTL_MS) return null;
  return entry.logoUrl;
}

async function ensureLogo(tabId, symbol) {
  const sym = String(symbol || '').toUpperCase();
  if (!sym) return null;

  const cached = getCachedLogo(sym);
  if (cached) return cached;

  try {
    const prof = await apiClient.stockProfile2({ keyName: tabId, symbol: sym });
    const url = normalizeLogoUrl(prof?.logo);
    if (url) {
      logoCache[sym] = { logoUrl: url, lastFetchMs: nowMs() };
      storage.setJSON(LOGO_CACHE_KEY, logoCache);
      return url;
    }
  } catch (_) {
    // ignore profile errors
  }

  return null;
}

/* ---------------------------- Forex helpers (metals) --------------------------- */

function parseFxPair(pair) {
  const s = String(pair || '').toUpperCase();
  if (s.length < 6) return null;
  return { base: s.slice(0, 3), quote: s.slice(3, 6) };
}

function priceFromUsdBaseRates(pair, ratesJson) {
  // /forex/rates?base=USD returns quote map:
  // quote[XAU] = XAU per 1 USD
  // For XAUUSD (USD per XAU), invert: 1 / quote[XAU]
  const p = parseFxPair(pair);
  if (!p) return null;
  if (p.quote !== 'USD') return null;

  const r = ratesJson?.quote?.[p.base];
  if (!isFiniteNum(r) || r === 0) return null;
  return 1 / r;
}

async function ensureFxRatesUsd(tabId) {
  const cached = fxMem.get(tabId);
  if (cached && (nowMs() - cached.fetchedAtMs) < FX_TTL_MS) return cached.ratesJson;

  // Optional: keep weekday-only consistency for metals/FX
  const nowSec = Math.floor(nowMs() / 1000);
  if (nyTime.isWeekend(nowSec) && cached?.ratesJson) {
    return cached.ratesJson; // hold last weekday cache on weekends
  }

  const json = await apiClient.forexRates({ keyName: tabId, base: 'USD' });
  fxMem.set(tabId, { fetchedAtMs: nowMs(), ratesJson: json });
  return json;
}

/* --------------------------------- Public API -------------------------------- */

export const quoteService = {
  TIMEFRAMES,

  getTabLastUpdatedMs(tabId) {
    return loadTabDisk(tabId)?.lastUpdatedMs || 0;
  },

  getSnapshot(tabId, spec, timeframe) {
    mergeDiskIntoMem(tabId);

    const key = symbolKey(spec);
    const rec = getTabMem(tabId).get(key);

    const last = isFiniteNum(rec?.last) ? rec.last : null;
    const q = rec?.quote || null;

    let changePct = null;

    // 1D: use Finnhub quote dp/pc when available
    if (last != null) {
      if (timeframe === TIMEFRAMES.ONE_DAY) {
        if (isFiniteNum(q?.dp)) changePct = q.dp;
        else if (isFiniteNum(q?.pc) && q.pc !== 0) changePct = pctChange(q.pc, last);
      } else {
        // No reliable 1W/1M from quote-only (needs historical series provider)
        changePct = null;
      }
    }

    // Sparkline: from recent quote refreshes (session-ish)
    const spark = Array.isArray(rec?.spark) ? rec.spark : [];

    return {
      last,
      changePct,
      spark,
      logoUrl: rec?.logoUrl || null
    };
  },

  // Fetch quote + (for stocks) logo. Returns true if record updated.
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
          type: spec.type,
          symbol: String(spec.symbol || '').toUpperCase(),
          last: null,
          quote: null,
          updatedMs: 0,
          logoUrl: null,
          spark: []
        };

      const age = nowMs() - (existing.updatedMs || 0);
      if (!force && existing.updatedMs && age < QUOTE_TTL_MS) {
        // Still ensure logo lazily if missing (but don't spam)
        if (existing.type === 'stock' && !existing.logoUrl) {
          const cachedLogo = getCachedLogo(existing.symbol);
          if (cachedLogo) {
            existing.logoUrl = cachedLogo;
            writeSymbol(tabId, key, existing);
            return true;
          }
        }
        return false;
      }

      let updated = false;

      if (spec.type === 'forex') {
        // Metals: XAUUSD etc via forex rates (USD base)
        try {
          const rates = await ensureFxRatesUsd(tabId);
          const price = priceFromUsdBaseRates(spec.symbol, rates);

          if (isFiniteNum(price)) {
            existing.last = price;
            existing.quote = { c: price, t: Math.floor(nowMs() / 1000) };
            existing.updatedMs = nowMs();

            existing.spark ||= [];
            existing.spark.push({ t: existing.updatedMs, c: price });
            if (existing.spark.length > SPARK_MAX_POINTS) existing.spark = existing.spark.slice(-SPARK_MAX_POINTS);

            updated = true;
          }
        } catch (_) {
          // ignore
        }
      } else {
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
          } catch (_) {
            // continue
          }
        }

        if (q && usedSymbol) {
          existing.symbol = String(spec.symbol || '').toUpperCase();
          existing.resolvedSymbol = usedSymbol;
          existing.quote = q;
          existing.last = q.c;
          existing.updatedMs = nowMs();

          existing.spark ||= [];
          existing.spark.push({ t: existing.updatedMs, c: q.c });
          if (existing.spark.length > SPARK_MAX_POINTS) existing.spark = existing.spark.slice(-SPARK_MAX_POINTS);

          // Logo fetch (MarketDB pattern: profile2, cached long-term)
          if (!existing.logoUrl) {
            const cachedLogo = getCachedLogo(usedSymbol);
            if (cachedLogo) {
              existing.logoUrl = cachedLogo;
            } else {
              const logo = await ensureLogo(tabId, usedSymbol);
              if (logo) existing.logoUrl = logo;
            }
          }

          updated = true;
        }
      }

      if (updated) {
        writeSymbol(tabId, key, existing);
      }
      return updated;
    })().finally(() => {
      inflight.delete(inflightKey);
    });

    inflight.set(inflightKey, p);
    return p;
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
    logoUrl: rec.logoUrl || null,
    updatedMs: rec.updatedMs || 0,
    spark: Array.isArray(rec.spark) ? rec.spark.slice(-SPARK_MAX_POINTS) : []
  };
  disk.lastUpdatedMs = Math.max(disk.lastUpdatedMs || 0, rec.updatedMs || 0);
  saveTabDisk(tabId, disk);
}
