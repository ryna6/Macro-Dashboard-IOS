// src/data/twelveDataClient.js
// Minimal Twelve Data REST wrapper (used as a fallback provider when Finnhub candles are restricted).
//
// Notes on credits/rate-limits:
// - Twelve Data counts credits per *symbol* even when batching multiple symbols in one request.

const TWELVEDATA_BASE = 'https://api.twelvedata.com';

const TWELVEDATA_KEYS = {
  global: 'c06be89dbb3f483eb8d5b126139bc91d',
  metals: 'aceb4424b004438ab40f83483b8e418f',
  commods: '690cf497d4ed45a8a91948a38da23e70',
  rates: 'f50fcec0077b420ebf43941663ab81a4',
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
    date,
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
        date,
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
