// src/data/quoteService.js
// Overview tiles: last price + % change.
//
// For stocks/ETFs: Finnhub /quote.
// For metals FX pairs (XAUUSD, XAGUSD, XPTUSD, XPDUSD): Finnhub /forex/rates
// (base=USD) and invert to get USD-per-asset.

import { apiClient } from './apiClient.js';
import { storage } from './storage.js';
import { nyTime } from './time.js';
import { TIMEFRAMES } from './candleService.js';

const TAB_CACHE_PREFIX = 'macrodb:quotes:v2:'; // + tabId

// Logos (stock/profile2) — mirrors MarketDB approach
const PROFILE_CACHE_KEY = 'macrodb:profiles:v1';
const PROFILE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week
let profileCache = storage.getJSON(PROFILE_CACHE_KEY) || {}; // symbol -> { logoUrl, name, lastFetchMs }

function normalizeLogoUrl(logo) {
  if (!logo) return null;
  const s = String(logo).trim();
  if (!s) return null;
  return s.startsWith('http') ? s : `https://${s.replace(/^\/+/, '')}`;
}

function isProfileStale(p) {
  if (!p?.lastFetchMs) return true;
  return nowMs() - p.lastFetchMs > PROFILE_TTL_MS;
}

function saveProfiles() {
  storage.setJSON(PROFILE_CACHE_KEY, profileCache);
}

async function ensureProfile(tabId, symbol) {
  const key = String(symbol || '').toUpperCase();
  if (!key) return null;

  const cached = profileCache[key];
  if (cached && !isProfileStale(cached)) return cached;

  try {
    const data = await apiClient.stockProfile2({ keyName: tabId, symbol: key });
    const p = {
      name: data?.name || data?.ticker || key,
      logoUrl: normalizeLogoUrl(data?.logo),
      lastFetchMs: nowMs()
    };
    profileCache[key] = p;
    saveProfiles();
    return p;
  } catch {
    return cached || null;
  }
}

function getLogoUrlForRecord(spec, rec) {
  if (!spec || spec.type === 'forex') return null;
  const sym = String(rec?.resolvedSymbol || spec.symbol || '').toUpperCase();
  const p = profileCache[sym];
  return p?.logoUrl || null;
}

// Metals FX fallback: if /forex/rates can't return XAU/XAG/XPT/XPD on your plan,
// approximate using liquid metal ETFs so the tab is never blank.
const METALS_PROXY_ETF = {
  XAUUSD: 'GLD',
  XAGUSD: 'SLV',
  XPTUSD: 'PPLT',
  XPDUSD: 'PALL'
};

// Per-tab in-memory cache for fast UI
const mem = new Map(); // tabId -> Map(symbolKey -> record)

const QUOTE_TTL_MS = 2 * 60 * 1000;
const REQUEST_SPACING_MS = 120;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function nowMs() {
  return Date.now();
}

function isFiniteNum(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

function symbolKey(spec) {
  return `${spec.type}:${spec.symbol}`;
}

function loadTabDisk(tabId) {
  return storage.getJSON(`${TAB_CACHE_PREFIX}${tabId}`) || { symbols: {}, lastUpdatedMs: 0 };
}

function saveTabDisk(tabId, obj) {
  storage.setJSON(`${TAB_CACHE_PREFIX}${tabId}`, obj);
}

function getTabMem(tabId) {
  if (!mem.has(tabId)) mem.set(tabId, new Map());
  return mem.get(tabId);
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

function nyYmd(ms) {
  const p = nyTime.parts(Math.floor(ms / 1000));
  const m = String(p.month).padStart(2, '0');
  const d = String(p.day).padStart(2, '0');
  return `${p.year}-${m}-${d}`;
}

function lastWeekdayKey(ms) {
  let t = ms;
  // Walk back to Friday if weekend in NY.
  while (nyTime.isWeekend(Math.floor(t / 1000))) t -= 24 * 60 * 60 * 1000;
  return nyYmd(t);
}

function updateDaily(rec, ms) {
  const key = lastWeekdayKey(ms);
  rec.daily ||= {};
  if (rec.quote && isFiniteNum(rec.quote.c)) {
    rec.daily[key] = rec.quote.c;
  }
}

function getBaselineFromDaily(dailyObj, sessionsBack) {
  const keys = Object.keys(dailyObj || {}).sort();
  if (keys.length < sessionsBack + 1) return null;
  return dailyObj[keys[keys.length - 1 - sessionsBack]];
}

function shouldFetch(rec, force) {
  if (force) return true;
  if (!rec?.quote) return true;
  const age = nowMs() - (rec.updatedMs || 0);
  return age > QUOTE_TTL_MS;
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
    quote: rec.quote
      ? {
          c: rec.quote.c,
          dp: rec.quote.dp,
          pc: rec.quote.pc,
          t: rec.quote.t
        }
      : null,
    updatedMs: rec.updatedMs || 0,
    daily: rec.daily || {}
  };
  disk.lastUpdatedMs = Math.max(disk.lastUpdatedMs || 0, rec.updatedMs || 0);
  saveTabDisk(tabId, disk);
}

async function fetchStockQuoteWithFallback(tabId, spec) {
  const candidates = [spec.symbol];
  if (spec.fallback) candidates.push(spec.fallback);

  for (const sym of candidates) {
    try {
      const q = await apiClient.quote({ keyName: tabId, symbol: sym });
      // Finnhub quote returns c/d/dp/h/l/o/pc/t (fields may be 0 if unavailable)
      if (q && isFiniteNum(q.c) && q.c !== 0) return { quote: q, usedSymbol: sym };
    } catch {
      // continue
    }
  }

  return { quote: null, usedSymbol: null };
}

function parseFxPair(pair) {
  const s = String(pair || '').toUpperCase();
  if (s.length < 6) return null;
  return { base: s.slice(0, 3), quote: s.slice(3, 6) };
}

function priceFromUsdBaseRates(pair, rates) {
  // Finnhub /forex/rates returns base + quote map.
  // With base=USD, quote[XAU] means: 1 USD = quote[XAU] XAU.
  // For XAUUSD (USD per XAU), invert: 1 XAU = 1/quote[XAU] USD.
  const p = parseFxPair(pair);
  if (!p) return null;
  if (p.quote !== 'USD') return null;
  const r = rates?.quote?.[p.base];
  if (!isFiniteNum(r) || r === 0) return null;
  return 1 / r;
}

export const quoteService = {
  TIMEFRAMES,

  getTabLastUpdatedMs(tabId) {
    return loadTabDisk(tabId)?.lastUpdatedMs || 0;
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
        // Prefer dp if available; else compute from previous close (pc),
        // else compute from stored daily baseline (yesterday close).
        if (isFiniteNum(q?.dp)) changePct = q.dp;
        else if (isFiniteNum(q?.pc) && q.pc !== 0) changePct = pctChange(q.pc, last);
        else changePct = pctChange(getBaselineFromDaily(rec?.daily, 1), last);
      } else if (timeframe === TIMEFRAMES.ONE_WEEK) {
        changePct = pctChange(getBaselineFromDaily(rec?.daily, 5), last);
      } else if (timeframe === TIMEFRAMES.ONE_MONTH) {
        changePct = pctChange(getBaselineFromDaily(rec?.daily, 21), last);
      }
    }

    // Mini sparkline points are kept in-memory only.
    const spark = rec?.spark || null;
    const logoUrl = getLogoUrlForRecord(spec, rec);
    return { last, changePct, spark, logoUrl };
  },

  async prefetchTab(tabId, specs, { force = false } = {}) {
    mergeDiskIntoMem(tabId);

    const m = getTabMem(tabId);
    const disk = loadTabDisk(tabId);
    let lastUpdatedMs = disk?.lastUpdatedMs || 0;

    const fxSpecs = (specs || []).filter((s) => s.type === 'forex');
    const stockSpecs = (specs || []).filter((s) => s.type !== 'forex');

    // ---------------------------------------------------------------------
    // FX: fetch once via /forex/rates (USD base)
    // ---------------------------------------------------------------------
    let usdRates = null;
    if (fxSpecs.length) {
      try {
        // Skip weekend updates for FX so the app stays “weekday-only” consistent.
        const nowSec = Math.floor(Date.now() / 1000);
        if (!nyTime.isWeekend(nowSec)) {
          usdRates = await apiClient.forexRates({ keyName: tabId, base: 'USD' });
        }
      } catch {
        usdRates = null;
      }
    }

    for (const spec of fxSpecs) {
      const key = symbolKey(spec);
      const existing =
        m.get(key) || {
          symbol: spec.symbol,
          type: spec.type,
          quote: null,
          updatedMs: 0,
          daily: disk.symbols?.[key]?.daily || {},
          spark: []
        };

      if (!shouldFetch(existing, force)) continue;

      // Primary: FX rates inversion
      let price = usdRates ? priceFromUsdBaseRates(spec.symbol, usdRates) : null;

      // Fallback: ETF proxy quote (keeps the tab alive on plans where FX endpoints are gated)
      let proxyQuote = null;
      if (!isFiniteNum(price)) {
        const proxy = METALS_PROXY_ETF[String(spec.symbol || '').toUpperCase()];
        if (proxy) {
          const r = await fetchStockQuoteWithFallback(tabId, { type: 'stock', symbol: proxy });
          proxyQuote = r.quote;
          if (proxyQuote && isFiniteNum(proxyQuote.c) && proxyQuote.c !== 0) {
            price = proxyQuote.c;
            existing.resolvedSymbol = proxy;
          }
        }
      }

      if (isFiniteNum(price)) {
        const t = Math.floor(nowMs() / 1000);

        // If we used a proxy quote, keep dp/pc from that quote when available.
        const pc = isFiniteNum(proxyQuote?.pc)
          ? proxyQuote.pc
          : getBaselineFromDaily(existing.daily, 1);
        const dp = isFiniteNum(proxyQuote?.dp) ? proxyQuote.dp : pctChange(pc, price);

        existing.quote = {
          c: price,
          pc: isFiniteNum(pc) ? pc : undefined,
          dp: isFiniteNum(dp) ? dp : undefined,
          t
        };
        existing.updatedMs = nowMs();
        updateDaily(existing, existing.updatedMs);

        existing.spark ||= [];
        existing.spark.push({ t: existing.updatedMs, p: price });
        if (existing.spark.length > 30) existing.spark = existing.spark.slice(-30);

        writeSymbol(tabId, key, existing);
        lastUpdatedMs = Math.max(lastUpdatedMs, existing.updatedMs);
      }

      await sleep(REQUEST_SPACING_MS);
    }

    // ---------------------------------------------------------------------
    // Stocks/ETFs: /quote per symbol (rate-limit aware)
    // ---------------------------------------------------------------------
    for (const spec of stockSpecs) {
      const key = symbolKey(spec);
      const existing =
        m.get(key) || {
          symbol: spec.symbol,
          type: spec.type,
          quote: null,
          updatedMs: 0,
          daily: disk.symbols?.[key]?.daily || {},
          spark: []
        };

      if (!shouldFetch(existing, force)) continue;

      const { quote, usedSymbol } = await fetchStockQuoteWithFallback(tabId, spec);

      existing.symbol = spec.symbol;
      existing.type = spec.type;
      existing.quote = quote;
      existing.resolvedSymbol = usedSymbol;
      existing.updatedMs = nowMs();

      // Logo/profile: cached aggressively (1 week) — so this is typically 0 extra calls.
      if (usedSymbol || spec.symbol) {
        await ensureProfile(tabId, (usedSymbol || spec.symbol));
      }

      updateDaily(existing, existing.updatedMs);

      if (quote && isFiniteNum(quote.c)) {
        existing.spark ||= [];
        existing.spark.push({ t: existing.updatedMs, p: quote.c });
        if (existing.spark.length > 30) existing.spark = existing.spark.slice(-30);
      }

      writeSymbol(tabId, key, existing);
      lastUpdatedMs = Math.max(lastUpdatedMs, existing.updatedMs);

      await sleep(REQUEST_SPACING_MS);
    }

    // persist lastUpdated even if nothing updated
    const out = loadTabDisk(tabId);
    out.lastUpdatedMs = Math.max(out.lastUpdatedMs || 0, lastUpdatedMs || 0);
    saveTabDisk(tabId, out);
  }
};
