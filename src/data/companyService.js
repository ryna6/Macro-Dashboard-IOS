// src/data/companyService.js
import { apiClient } from './apiClient.js';
import { storage } from './storage.js';

const LS_KEY = 'macrodb:companyProfiles:v1';
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

let cache = storage.getJSON(LS_KEY) || {}; // SYMBOL -> { symbol, name, logoUrl, lastFetchMs }

function save() {
  storage.setJSON(LS_KEY, cache);
}

function isStale(lastFetchMs) {
  if (!lastFetchMs) return true;
  return Date.now() - lastFetchMs > TTL_MS;
}

function normalizeLogoUrl(logo) {
  if (!logo) return null;
  const s = String(logo).trim();
  if (!s) return null;
  return s.startsWith('http') ? s : `https://${s.replace(/^\/+/, '')}`;
}

// tabId is only used to pick which Finnhub key to use.
// (You can pass 'global' always if you prefer.)
export async function getCompanyProfile(symbol, tabId) {
  const key = String(symbol || '').toUpperCase();
  if (!key) return null;

  const cached = cache[key];
  if (cached && !isStale(cached.lastFetchMs)) return cached;

  const data = await apiClient.stockProfile2({ keyName: tabId, symbol: key });

  const profile = {
    symbol: key,
    name: data?.name || data?.ticker || key,
    logoUrl: normalizeLogoUrl(data?.logo),
    lastFetchMs: Date.now()
  };

  cache[key] = profile;
  save();
  return profile;
}
