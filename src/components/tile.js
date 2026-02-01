import { candleService } from '../data/candleService.js';
import { quoteService } from '../data/quoteService.js';
import { openTileExpanded } from './tileExpanded.js';

function el(tag, className) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  return n;
}

function fmtPrice(x) {
  if (x == null || !Number.isFinite(x)) return '—';
  const abs = Math.abs(x);
  const decimals = abs < 10 ? 4 : abs < 1000 ? 2 : 1;
  return x.toFixed(decimals);
}

function fmtPct(x) {
  if (x == null || !Number.isFinite(x)) return '—';
  const sign = x > 0 ? '+' : '';
  return `${sign}${x.toFixed(2)}%`;
}

function drawSpark(canvas, points) {
  const ctx = canvas?.getContext?.('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (!points || points.length < 2) return;
  const values = points.map((p) => p?.p).filter((v) => Number.isFinite(v));
  if (values.length < 2) return;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  ctx.lineWidth = 1.5;
  ctx.beginPath();

  values.forEach((v, i) => {
    const x = (i / (values.length - 1)) * (w - 2) + 1;
    const y = h - ((v - min) / range) * (h - 2) - 1;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.strokeStyle = 'rgba(255,255,255,0.65)';
  ctx.stroke();
}

function logoFallbackText(spec) {
  const sym = String(spec?.symbol || '').toUpperCase();
  // Nicely handle metal symbols
  if (sym.startsWith('XAU')) return 'Au';
  if (sym.startsWith('XAG')) return 'Ag';
  if (sym.startsWith('XPT')) return 'Pt';
  if (sym.startsWith('XPD')) return 'Pd';
  return (sym || '?').slice(0, 1);
}

export function createTile({ tabId, symbolSpec, timeframe }) {
  const root = el('div', 'tile');
  root.role = 'button';
  root.tabIndex = 0;

  const top = el('div', 'tile-top');
  const logo = el('div', 'tile-logo');

  // Logo image (stocks/ETFs) + fallback text (metals/unknown)
  const logoImg = document.createElement('img');
  logoImg.className = 'tile-logo-img';
  logoImg.alt = '';
  logoImg.decoding = 'async';
  logoImg.loading = 'lazy';
  logoImg.referrerPolicy = 'no-referrer';
  logoImg.hidden = true;

  const logoFallback = el('span', 'tile-logo-fallback');
  logoFallback.textContent = logoFallbackText(symbolSpec);

  // If the logo URL 404s or is blocked, fall back to text.
  logoImg.addEventListener('error', () => {
    logoImg.hidden = true;
    logoFallback.hidden = false;
  });

  logo.appendChild(logoImg);
  logo.appendChild(logoFallback);

  const sym = el('div', 'tile-symbol');
  sym.textContent = symbolSpec.symbol;

  top.appendChild(logo);
  top.appendChild(sym);

  const mid = el('div', 'tile-mid');
  const price = el('div', 'tile-price');
  const change = el('div', 'tile-change');
  mid.appendChild(price);
  mid.appendChild(change);

  const spark = el('canvas', 'tile-spark');
  spark.width = 220;
  spark.height = 38;

  root.appendChild(top);
  root.appendChild(mid);
  root.appendChild(spark);

  function update() {
    const snap = quoteService.getSnapshot(tabId, symbolSpec, timeframe);

    const logoUrl = snap.logoUrl;
    if (logoUrl && logoImg.dataset.src !== logoUrl) {
      logoImg.dataset.src = logoUrl;
      logoImg.src = logoUrl;
      logoImg.hidden = false;
      logoFallback.hidden = true;
    } else if (!logoUrl) {
      logoImg.hidden = true;
      logoFallback.hidden = false;
    }

    price.textContent = fmtPrice(snap.last);

    const pct = snap.changePct;
    change.textContent = fmtPct(pct);

    change.classList.toggle('is-up', pct != null && pct > 0);
    change.classList.toggle('is-down', pct != null && pct < 0);

    drawSpark(spark, (snap.spark || []).slice(-120));
  }

  function expand() {
    // Expanded view still attempts candles (you’ll swap provider next)
    const candles = candleService.getCandles(tabId, symbolSpec, timeframe);
    openTileExpanded({
      symbol: symbolSpec.symbol,
      displayName: symbolSpec.symbol,
      timeframeLabel: timeframe,
      candles
    });
  }

  root.addEventListener('click', () => {
    update();
    expand();
  });

  root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      update();
      expand();
    }
  });

  update();
  return { el: root, update };
}
