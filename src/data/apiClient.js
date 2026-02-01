// src/data/apiClient.js
const FINNHUB_BASE = 'https://finnhub.io/api/v1';

const DEFAULT_KEY = 'calendar';
/**
 * One Finnhub key per macro tab (1–4). Calendar can be separate or reused.
 * Replace these with your real keys.
 */
const FINNHUB_KEYS = {
  global: 'd4d73mhr01qovljoddigd4d73mhr01qovljoddj0',
  metals: 'd5s6af9r01qoo9r2t3a0d5s6af9r01qoo9r2t3ag ',
  commo: 'd5s6af9r01qoo9r2t3a0d5s6af9r01qoo9r2t3ag ',
  rates: 'd5s6jg1r01qoo9r2ukugd5s6jg1r01qoo9r2ukv0',
  calendar: 'd5s6jg1r01qoo9r2ukugd5s6jg1r01qoo9r2ukv0'
};

function envKeyName(keyName) {
  return `VITE_FINNHUB_KEY_${String(keyName || '').toUpperCase()}`;
}

function readToken(keyName) {
  const fromLs = (typeof window !== 'undefined' && window.localStorage)
    ? window.localStorage.getItem(`finnhub:key:${keyName}`) || ''
    : '';

  const fromEnv = (typeof import.meta !== 'undefined' && import.meta.env)
    ? (import.meta.env[envKeyName(keyName)] || '')
    : '';

  const fromHardcode = FINNHUB_KEYS[keyName] || '';

  // Priority: localStorage → env → hardcode
  return String(fromLs || fromEnv || fromHardcode || '').trim();
}

function isPlaceholder(token) {
  if (!token) return true;
  if (token.startsWith('YOUR_')) return true;
  if (token.length < 8) return true;
  return false;
}

function pickToken(keyName) {
  const wanted = keyName || DEFAULT_KEY;
  let token = readToken(wanted);
  if (!isPlaceholder(token)) return token;

  // fallback to global for dev convenience
  if (wanted !== DEFAULT_KEY) {
    token = readToken(DEFAULT_KEY);
    if (!isPlaceholder(token)) return token;
  }
  return '';
}

async function fetchJson(url, signal) {
  const res = await fetch(url, { signal, cache: 'no-store' });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
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
  return `${BASE}${path}?${usp.toString()}`;
}

export const apiClient = {
  // Quotes (overview tiles)
  quote: (keyName, symbol, signal) => {
    const url = buildUrl('/quote', { symbol }, keyName);
    return fetchJson(url, signal);
  },

  // Candles (may be premium depending on your plan)
  stockCandles: (keyName, symbol, resolution, from, to, signal) => {
    const url = buildUrl('/stock/candle', { symbol, resolution, from, to }, keyName);
    return fetchJson(url, signal);
  },

  forexExchanges: (keyName, signal) => {
    const url = buildUrl('/forex/exchange', {}, keyName);
    return fetchJson(url, signal);
  },

  forexSymbols: (keyName, exchange, signal) => {
    const url = buildUrl('/forex/symbol', { exchange }, keyName);
    return fetchJson(url, signal);
  },

  // Optional: can be used later for fallback (not required for current fix)
  forexRates: (keyName, base = 'USD', signal) => {
    const url = buildUrl('/forex/rates', { base }, keyName);
    return fetchJson(url, signal);
  },

  economicCalendar: (keyName, from, to, signal) => {
    const url = buildUrl('/calendar/economic', { from, to }, keyName);
    return fetchJson(url, signal);
  }
};
