// src/data/apiClient.js
// Finnhub REST wrapper.
//
// IMPORTANT:
// - This app supports "one API key per tab".
// - Keys are read in this priority order:
//   1) localStorage: finnhub:key:<tabId>
//   2) Vite env:     VITE_FINNHUB_KEY_<TABID>
//   3) hardcoded map below (keep empty in repo)

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

// Keep empty in repo. For quick testing you can paste keys here temporarily.
const FINNHUB_KEYS = {
  global: '',
  metals: '',
  commo: '',
  rates: '',
  calendar: ''
};

const DEFAULT_FALLBACK_KEY = 'global';

function envKeyName(tabId) {
  return `VITE_FINNHUB_KEY_${String(tabId).toUpperCase()}`;
}

function readTokenFor(tabId) {
  const k = String(tabId || '').trim() || DEFAULT_FALLBACK_KEY;

  // 1) localStorage override (best for testing without committing secrets)
  try {
    const ls = localStorage.getItem(`finnhub:key:${k}`);
    if (ls && ls.trim()) return ls.trim();
  } catch (_) {}

  // 2) Vite env
  try {
    const env = import.meta?.env?.[envKeyName(k)];
    if (env && String(env).trim()) return String(env).trim();
  } catch (_) {}

  // 3) hardcoded
  const hc = FINNHUB_KEYS[k];
  if (hc && String(hc).trim()) return String(hc).trim();

  // last fallback
  const fb = FINNHUB_KEYS[DEFAULT_FALLBACK_KEY];
  return fb && String(fb).trim() ? String(fb).trim() : '';
}

function buildUrl(path, params = {}, tabId) {
  const token = readTokenFor(tabId);
  const url = new URL(`${FINNHUB_BASE}${path}`);

  if (token) url.searchParams.set('token', token);

  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    url.searchParams.set(k, String(v));
  });

  return url.toString();
}

async function fetchJson(url, { signal } = {}) {
  const res = await fetch(url, { signal, cache: 'no-store' });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Finnhub HTTP ${res.status} ${res.statusText} :: ${t.slice(0, 180)}`);
  }
  return res.json();
}

// Allow both:
//   apiClient.quote({ keyName, symbol, signal })
// and
//   apiClient.quote(keyName, symbol, signal)
function normalizeArgs(arg1, arg2, arg3) {
  if (arg1 && typeof arg1 === 'object') return arg1;
  return { keyName: arg1, symbol: arg2, signal: arg3 };
}

function normalizeCandleArgs(arg1, arg2, arg3, arg4, arg5, arg6) {
  if (arg1 && typeof arg1 === 'object') return arg1;
  return { keyName: arg1, symbol: arg2, resolution: arg3, from: arg4, to: arg5, signal: arg6 };
}

function normalizeForexRatesArgs(arg1, arg2, arg3) {
  if (arg1 && typeof arg1 === 'object') return arg1;
  return { keyName: arg1, base: arg2, signal: arg3 };
}

function normalizeCalendarArgs(arg1, arg2, arg3, arg4) {
  if (arg1 && typeof arg1 === 'object') return arg1;
  return { keyName: arg1, from: arg2, to: arg3, signal: arg4 };
}

export const apiClient = {
  // Stocks/ETFs quote
  async quote(arg1, arg2, arg3) {
    const { keyName, symbol, signal } = normalizeArgs(arg1, arg2, arg3);
    const url = buildUrl('/quote', { symbol }, keyName);
    return fetchJson(url, { signal });
  },

  // Stocks candles
  async stockCandles(arg1, arg2, arg3, arg4, arg5, arg6) {
    const { keyName, symbol, resolution, from, to, signal } = normalizeCandleArgs(
      arg1,
      arg2,
      arg3,
      arg4,
      arg5,
      arg6
    );
    const url = buildUrl('/stock/candle', { symbol, resolution, from, to }, keyName);
    return fetchJson(url, { signal });
  },

  // Forex candles (for future expanded-tile provider use)
  async forexCandles(arg1, arg2, arg3, arg4, arg5, arg6) {
    const { keyName, symbol, resolution, from, to, signal } = normalizeCandleArgs(
      arg1,
      arg2,
      arg3,
      arg4,
      arg5,
      arg6
    );
    const url = buildUrl('/forex/candle', { symbol, resolution, from, to }, keyName);
    return fetchJson(url, { signal });
  },

  // Forex exchanges/symbol discovery (optional)
  async forexExchanges(arg1, arg2) {
    const { keyName, signal } = (arg1 && typeof arg1 === 'object') ? arg1 : { keyName: arg1, signal: arg2 };
    const url = buildUrl('/forex/exchange', {}, keyName);
    return fetchJson(url, { signal });
  },

  async forexSymbols(arg1, arg2, arg3) {
    const o = (arg1 && typeof arg1 === 'object') ? arg1 : { keyName: arg1, exchange: arg2, signal: arg3 };
    const url = buildUrl('/forex/symbol', { exchange: o.exchange }, o.keyName);
    return fetchJson(url, { signal: o.signal });
  },

  // Forex rates (used for metals overview)
  async forexRates(arg1, arg2, arg3) {
    const { keyName, base, signal } = normalizeForexRatesArgs(arg1, arg2, arg3);
    const url = buildUrl('/forex/rates', { base }, keyName);
    return fetchJson(url, { signal });
  },

  // Economic calendar
  async economicCalendar(arg1, arg2, arg3, arg4) {
    const { keyName, from, to, signal } = normalizeCalendarArgs(arg1, arg2, arg3, arg4);
    const url = buildUrl('/calendar/economic', { from, to }, keyName);
    return fetchJson(url, { signal });
  }
};
