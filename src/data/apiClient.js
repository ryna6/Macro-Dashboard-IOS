// src/data/apiClient.js
const FINNHUB_BASE = 'https://finnhub.io/api/v1';

/**
 * One Finnhub key per macro tab (1–4). Calendar can be separate or reused.
 * Replace these with your real keys.
 */
const FINNHUB_KEYS = {
  global: 'd4d73mhr01qovljoddigd4d73mhr01qovljoddj0',
  metals: ' ',
  commo: 'YOUR_FINNHUB_KEY_COMMO',
  rates: ' ',
  calendar: 'd4d73mhr01qovljoddigd4d73mhr01qovljoddj0' // optional (can reuse one above)
};

const DEFAULT_KEY = 'global';

/**
 * Basic per-key request queue + spacing to be rate-limit aware.
 * (Finnhub free tiers can be tight; spacing + retries helps a lot.)
 */
const queueState = new Map(); // keyName -> { tail: Promise, lastReqMs: number }

const MIN_SPACING_MS = 160; // small spacing between calls per key
const MAX_RETRIES = 3;

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true }
    );
  });
}

function pickToken(keyName) {
  const k = keyName && FINNHUB_KEYS[keyName] ? keyName : DEFAULT_KEY;
  const token = FINNHUB_KEYS[k];
  if (!token || token.startsWith('YOUR_')) {
    // Allow app to run, but make the misconfig obvious:
    console.warn(`[apiClient] Missing/placeholder Finnhub token for keyName="${k}".`);
  }
  return token;
}

async function fetchJsonWithRetry(url, { signal } = {}) {
  let attempt = 0;
  let backoffMs = 400;

  while (true) {
    const res = await fetch(url, { signal });

    if (res.status === 429) {
      if (attempt >= MAX_RETRIES) throw new Error('rate-limit');
      const retryAfter = res.headers.get('retry-after');
      const waitMs = retryAfter ? Number(retryAfter) * 1000 : backoffMs;
      await sleep(Math.max(250, waitMs), signal);
      attempt += 1;
      backoffMs *= 2;
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}${text ? `: ${text}` : ''}`);
    }

    return res.json();
  }
}

function enqueue(keyName, fn) {
  const state = queueState.get(keyName) || {
    tail: Promise.resolve(),
    lastReqMs: 0
  };

  const run = async () => {
    const since = Date.now() - state.lastReqMs;
    if (since < MIN_SPACING_MS) {
      await sleep(MIN_SPACING_MS - since);
    }
    state.lastReqMs = Date.now();
    return fn();
  };

  const p = state.tail.then(run, run);

  // Keep queue alive even if this request fails
  state.tail = p.catch(() => {});
  queueState.set(keyName, state);

  return p;
}

function buildUrl(pathAndQuery, token) {
  const joiner = pathAndQuery.includes('?') ? '&' : '?';
  return `${FINNHUB_BASE}${pathAndQuery}${joiner}token=${encodeURIComponent(token)}`;
}

export const apiClient = {
  /**
   * Generic Finnhub call (queued per keyName).
   */
  finnhub(pathAndQuery, opts = {}) {
    const keyName = opts.keyName || DEFAULT_KEY;
    const token = pickToken(keyName);
    const url = buildUrl(pathAndQuery, token);

    return enqueue(keyName, () => fetchJsonWithRetry(url, { signal: opts.signal }));
  },

  /**
   * Stock candles (ETFs, rates ETFs, etc.) via /stock/candle :contentReference[oaicite:3]{index=3}
   */
  stockCandles({ symbol, resolution, from, to, keyName, signal }) {
    const q =
      `/stock/candle?symbol=${encodeURIComponent(symbol)}` +
      `&resolution=${encodeURIComponent(resolution)}` +
      `&from=${encodeURIComponent(from)}` +
      `&to=${encodeURIComponent(to)}`;
    return this.finnhub(q, { keyName, signal });
  },

  /**
   * Forex candles via /forex/candle (metals FX pairs) :contentReference[oaicite:4]{index=4}
   */
  forexCandles({ symbol, resolution, from, to, keyName, signal }) {
    const q =
      `/forex/candle?symbol=${encodeURIComponent(symbol)}` +
      `&resolution=${encodeURIComponent(resolution)}` +
      `&from=${encodeURIComponent(from)}` +
      `&to=${encodeURIComponent(to)}`;
    return this.finnhub(q, { keyName, signal });
  },

  /**
   * Forex symbol discovery via /forex/symbol?exchange=OANDA :contentReference[oaicite:5]{index=5}
   */
  forexSymbols({ exchange = 'OANDA', keyName, signal }) {
    const q = `/forex/symbol?exchange=${encodeURIComponent(exchange)}`;
    return this.finnhub(q, { keyName, signal });
  },

  /**
   * Economic calendar via /calendar/economic :contentReference[oaicite:6]{index=6}
   */
  economicCalendar({ from, to, keyName, signal }) {
    const q =
      `/calendar/economic?from=${encodeURIComponent(from)}` +
      `&to=${encodeURIComponent(to)}`;
    return this.finnhub(q, { keyName, signal });
  }
};
