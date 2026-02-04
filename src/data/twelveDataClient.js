const TWELVEDATA_BASE = 'https://api.twelvedata.com';

const TWELVEDATA_KEYS = {
  global: 'c06be89dbb3f483eb8d5b126139bc91d',
  metals: 'aceb4424b004438ab40f83483b8e418f',
  commods: 'aceb4424b004438ab40f83483b8e418f',
  rates: 'f50fcec0077b420ebf43941663ab81a4',
};

function tokenFor(tabId) {
  const token = (TWELVEDATA_KEYS[String(tabId)] || '').trim();
  if (!token) throw new Error(`Missing Twelve Data API key for tab "${tabId}".`);
  return token;
}

async function fetchJson(url, { signal } = {}) {
  const res = await fetch(url, { signal, cache: 'no-store' });
  const data = await res.json().catch(() => ({}));

  const status = String(data?.status || '').toLowerCase();
  if (!res.ok || status === 'error') {
    const err = new Error(data?.message || `TwelveData HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const twelveDataClient = {
  async timeSeries({
    keyName,
    symbol,
    interval,
    outputsize,
    date,
    start_date,
    end_date,
    timezone,
    signal
  }) {
    const url = new URL(`${TWELVEDATA_BASE}/time_series`);
    url.searchParams.set('apikey', tokenFor(keyName));
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('interval', interval);

    if (outputsize) url.searchParams.set('outputsize', String(outputsize));
    if (date) url.searchParams.set('date', String(date));
    if (start_date) url.searchParams.set('start_date', String(start_date));
    if (end_date) url.searchParams.set('end_date', String(end_date));
    if (timezone) url.searchParams.set('timezone', String(timezone));
    url.searchParams.set('format', 'JSON');

    return fetchJson(url.toString(), { signal });
  }
};
