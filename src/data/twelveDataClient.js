// src/data/twelveDataClient.js
// Minimal Twelve Data REST wrapper (used as a fallback provider when Finnhub candles are restricted).
//
// Notes on credits/rate-limits:
// - Twelve Data counts credits per *symbol* even when batching multiple symbols in one request.
// - The free/basic plan is commonly listed as 8 credits/minute and 800 credits/day (see Twelve Data support).
// - This app intentionally requests only small daily windows for 1W/1M baselines.

const TWELVEDATA_BASE = 'https://api.twelvedata.com';

// Mirror your Finnhub key mapping style: one key per tab.
// Fill these with your own keys (or replace with env injection if you later add a backend).
const TWELVEDATA_KEYS = {
  global: '',  // Tab 1
  metals: '',  // Tab 2
  commo: '',   // Tab 3
  rates: '',   // Tab 4
  calendar: '' // Tab 5 (not used unless you add TwelveData calendar endpoints)
};

function tokenFor(tabId) {
  const key = String(tabId || '').trim();
  const token = (TWELVEDATA_KEYS[key] || '').trim();
  if (!token) throw new Error(`Missing Twelve Data API key for tab "${key}".`);
  return token;
}

function buildUrl(path, params = {}, tabId) {
  const token = tokenFor(tabId);
  const url = new URL(`${TWELVEDATA_BASE}${path}`);
  url.searchParams.set('apikey', token);

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

  // Twelve Data typically returns 200 with status="error" in JSON
  const status = String(data?.status || '').toLowerCase();
  if (!res.ok || status === 'error') {
    const msg = data?.message || data?.error || `Twelve Data HTTP ${res.status} ${res.statusText}`;
    const err = new Error(msg);
    err.status = res.status;
    err.url = url;
    err.data = data;
    throw err;
  }

  return data;
}

export const twelveDataClient = {
  async timeSeries({
    keyName,
    symbol,
    interval = '1day',
    outputsize = 30,
    start_date,
    end_date,
    timezone,
    signal
  }) {
    const url = buildUrl(
      '/time_series',
      {
        symbol,
        interval,
        outputsize,
        start_date,
        end_date,
        timezone,
        format: 'JSON'
      },
      keyName
    );

    return fetchJson(url, { signal });
  }
};
