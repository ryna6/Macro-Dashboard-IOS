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
  global: 'd4d73mhr01qovljoddigd4d73mhr01qovljoddj0',
  metals: 'd5s6af9r01qoo9r2t3a0d5s6af9r01qoo9r2t3ag ',
  commo: 'd5s6af9r01qoo9r2t3a0d5s6af9r01qoo9r2t3ag ',
  rates: 'd5s6jg1r01qoo9r2ukugd5s6jg1r01qoo9r2ukv0',
  calendar: 'd5s6jg1r01qoo9r2ukugd5s6jg1r01qoo9r2ukv0'
};

const DEFAULT_KEY = 'calendar';

function envKeyName(keyName) {
  return `VITE_FINNHUB_KEY_${String(keyName || '').toUpperCase()}`;
}

function readToken(keyName) {
  const k = String(keyName || '').trim();

  // 1) localStorage override (best for quick testing)
  try {
    const ls = window?.localStorage?.getItem(`finnhub:key:${k}`);
    if (ls && String(ls).trim()) return String(ls).trim();
  } catch (_) {}

  // 2) build-time env
  try {
    const env = import.meta?.env?.[envKeyName(k)];
    if (env && String(env).trim()) return String(env).trim();
  } catch (_) {}

  // 3) hardcoded
  const hc = FINNHUB_KEYS[k];
  if (hc && String(hc).trim()) return String(hc).trim();

  return '';
}

function pickToken(keyName) {
  const token = readToken(keyName);
  if (token) return token;
  // fallback to global
  if (keyName && keyName !== DEFAULT_KEY) return readToken(DEFAULT_KEY);
  return '';
}

async function fetchJson(url, signal) {
  const res = await fetch(url, { signal, cache: 'no-store' });
  const text = await res.text().catch(() => '');
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const msg = data?.error || data?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function buildUrl(path, params, keyName) {
  const token = pickToken(keyName);
  if (!token) throw new Error(`Missing Finnhub API key for tab "${keyName}"`);
  const usp = new URLSearchParams({ ...params, token });
  return `${FINNHUB_BASE}${path}?${usp.toString()}`;
}

// Normalize object-style vs positional-style calls.
function norm2(arg1, arg2) {
  if (arg1 && typeof arg1 === 'object') return arg1;
  return { keyName: arg1, signal: arg2 };
}

function normQuote(arg1, arg2, arg3) {
  if (arg1 && typeof arg1 === 'object') return arg1;
  return { keyName: arg1, symbol: arg2, signal: arg3 };
}

function normCandles(arg1, arg2, arg3, arg4, arg5, arg6) {
  if (arg1 && typeof arg1 === 'object') return arg1;
  return { keyName: arg1, symbol: arg2, resolution: arg3, from: arg4, to: arg5, signal: arg6 };
}

function normForexSymbols(arg1, arg2, arg3) {
  if (arg1 && typeof arg1 === 'object') return arg1;
  return { keyName: arg1, exchange: arg2, signal: arg3 };
}

function normForexRates(arg1, arg2, arg3) {
  if (arg1 && typeof arg1 === 'object') return arg1;
  return { keyName: arg1, base: arg2, signal: arg3 };
}

function normCalendar(arg1, arg2, arg3, arg4) {
  if (arg1 && typeof arg1 === 'object') return arg1;
  return { keyName: arg1, from: arg2, to: arg3, signal: arg4 };
}

export const apiClient = {
  // Quotes (US stocks/ETFs)
  quote(arg1, arg2, arg3) {
    const { keyName, symbol, signal } = normQuote(arg1, arg2, arg3);
    const url = buildUrl('/quote', { symbol }, keyName);
    return fetchJson(url, signal);
  },

  // Company profile (logo)
  stockProfile2(arg1, arg2, arg3) {
    const { keyName, symbol, signal } = normQuote(arg1, arg2, arg3);
    const url = buildUrl('/stock/profile2', { symbol }, keyName);
    return fetchJson(url, signal);
  },

  // Candles (may be plan-limited)
  stockCandles(arg1, arg2, arg3, arg4, arg5, arg6) {
    const { keyName, symbol, resolution, from, to, signal } = normCandles(
      arg1,
      arg2,
      arg3,
      arg4,
      arg5,
      arg6
    );
    const url = buildUrl('/stock/candle', { symbol, resolution, from, to }, keyName);
    return fetchJson(url, signal);
  },

  forexCandles(arg1, arg2, arg3, arg4, arg5, arg6) {
    const { keyName, symbol, resolution, from, to, signal } = normCandles(
      arg1,
      arg2,
      arg3,
      arg4,
      arg5,
      arg6
    );
    const url = buildUrl('/forex/candle', { symbol, resolution, from, to }, keyName);
    return fetchJson(url, signal);
  },

  forexExchanges(arg1, arg2) {
    const { keyName, signal } = norm2(arg1, arg2);
    const url = buildUrl('/forex/exchange', {}, keyName);
    return fetchJson(url, signal);
  },

  forexSymbols(arg1, arg2, arg3) {
    const { keyName, exchange, signal } = normForexSymbols(arg1, arg2, arg3);
    const url = buildUrl('/forex/symbol', { exchange }, keyName);
    return fetchJson(url, signal);
  },

  forexRates(arg1, arg2 = 'USD', arg3) {
    const { keyName, base, signal } = normForexRates(arg1, arg2, arg3);
    const url = buildUrl('/forex/rates', { base }, keyName);
    return fetchJson(url, signal);
  },

  economicCalendar(arg1, arg2, arg3, arg4) {
    const { keyName, from, to, signal } = normCalendar(arg1, arg2, arg3, arg4);
    const url = buildUrl('/calendar/economic', { from, to }, keyName);
    return fetchJson(url, signal);
  }
};
