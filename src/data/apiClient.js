// src/data/apiClient.js
// Finnhub REST wrapper.

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

const FINNHUB_KEYS = {
  global: 'd4d73mhr01qovljoddigd4d73mhr01qovljoddj0',
  metals: 'd5s6af9r01qoo9r2t3a0d5s6af9r01qoo9r2t3ag ',
  commods: 'd5s6af9r01qoo9r2t3a0d5s6af9r01qoo9r2t3ag ',
  rates: 'd5s6jg1r01qoo9r2ukugd5s6jg1r01qoo9r2ukv0',
  calendar: 'd5s6jg1r01qoo9r2ukugd5s6jg1r01qoo9r2ukv0'
};

function tokenFor(tabId) {
  const key = String(tabId || '').trim();
  const token = (FINNHUB_KEYS[key] || '').trim();
  if (!token) {
    throw new Error(`Missing Finnhub API key for tab "${key}".`);
  }
  return token;
}

function buildUrl(path, params = {}, tabId) {
  const token = tokenFor(tabId);
  const url = new URL(`${FINNHUB_BASE}${path}`);
  url.searchParams.set('token', token);

  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    url.searchParams.set(k, String(v));
  });

  return url.toString();
}

async function fetchJson(url, { signal } = {}) {
  const res = await fetch(url, { signal, cache: 'no-store' });
  const text = await res.text().catch(() => '');
  let data = null;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const msg =
      data?.error ||
      data?.message ||
      `Finnhub HTTP ${res.status} ${res.statusText}`;
    const err = new Error(msg);
    err.status = res.status;
    err.url = url;
    throw err;
  }

  return data;
}

// Support both object-style and positional-style calls
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

  // Company profile (logos)
  async stockProfile2(arg1, arg2, arg3) {
    const { keyName, symbol, signal } = normalizeArgs(arg1, arg2, arg3);
    const url = buildUrl('/stock/profile2', { symbol }, keyName);
    return fetchJson(url, { signal });
  },

  // Stock candles (may be plan-limited)
  async stockCandles(arg1, arg2, arg3, arg4, arg5, arg6) {
    const { keyName, symbol, resolution, from, to, signal } = normalizeCandleArgs(
      arg1, arg2, arg3, arg4, arg5, arg6
    );
    const url = buildUrl('/stock/candle', { symbol, resolution, from, to }, keyName);
    return fetchJson(url, { signal });
  },

  // Forex candles
  async forexCandles(arg1, arg2, arg3, arg4, arg5, arg6) {
    const { keyName, symbol, resolution, from, to, signal } = normalizeCandleArgs(
      arg1, arg2, arg3, arg4, arg5, arg6
    );
    const url = buildUrl('/forex/candle', { symbol, resolution, from, to }, keyName);
    return fetchJson(url, { signal });
  },

  // Forex rates (used for metals overview)
  async forexRates(arg1, arg2, arg3) {
    const { keyName, base, signal } = normalizeForexRatesArgs(arg1, arg2, arg3);
    const url = buildUrl('/forex/rates', { base }, keyName);
    return fetchJson(url, { signal });
  },

  // Economic calendar (may be plan-limited)
  async economicCalendar(arg1, arg2, arg3, arg4) {
    const { keyName, from, to, signal } = normalizeCalendarArgs(arg1, arg2, arg3, arg4);
    const url = buildUrl('/calendar/economic', { from, to }, keyName);
    return fetchJson(url, { signal });
  }
};
