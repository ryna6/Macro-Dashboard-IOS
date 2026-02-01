// src/components/tile.js
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
  const closes = points
    .map((p) => (typeof p?.c === 'number' ? p.c : null))
    .filter((v) => Number.isFinite(v));
  if (closes.length < 2) return;

  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;

  ctx.lineWidth = 1.5;
  ctx.beginPath();

  closes.forEach((v, i) => {
    const x = (i / (closes.length - 1)) * (w - 2) + 1;
    const y = h - ((v - min) / range) * (h - 2) - 1;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.strokeStyle = 'rgba(255,255,255,0.65)';
  ctx.stroke();
}

function logoFallbackText(spec) {
  const sym = String(spec?.symbol || '').toUpperCase();
  return (sym || '?').slice(0, 1);
}

function fixedLogoUrl(spec) {
  if (spec?.logoUrl) return spec.logoUrl;
  const sym = String(spec?.symbol || '').toUpperCase();
  return sym ? `/icons/symbols/${sym}.png` : null;
}

export function createTile({ tabId, symbolSpec, timeframe }) {
  const root = el('div', 'tile');
  root.role = 'button';
  root.tabIndex = 0;

  const top = el('div', 'tile-top');
  const logo = el('div', 'tile-logo');

  // IMG + fallback text
  const img = document.createElement('img');
  img.alt = '';
  img.decoding = 'async';
  img.loading = 'lazy';

  img.style.width = '100%';
  img.style.height = '100%';
  img.style.objectFit = 'contain';
  img.style.display = 'none';

  const fallback = document.createElement('span');
  fallback.textContent = logoFallbackText(symbolSpec);
  fallback.style.display = 'block';

  img.addEventListener('error', () => {
    img.style.display = 'none';
    fallback.style.display = 'block';
  });

  logo.appendChild(img);
  logo.appendChild(fallback);

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

  let refreshing = false;

  function paint() {
    const snap = quoteService.getSnapshot(tabId, symbolSpec, timeframe);

    // Prefer fixed local logo
    const logoUrl = fixedLogoUrl(symbolSpec) || snap.logoUrl;

    if (logoUrl) {
      if (img.dataset.src !== logoUrl) {
        img.dataset.src = logoUrl;
        img.src = logoUrl;
      }
      img.style.display = 'block';
      fallback.style.display = 'none';
    } else {
      img.style.display = 'none';
      fallback.style.display = 'block';
    }

    price.textContent = `$${fmtPrice(snap.last)}`;

    const pct = snap.changePct;
    change.textContent = fmtPct(pct);

    change.classList.toggle('is-up', pct != null && pct > 0);
    change.classList.toggle('is-down', pct != null && pct < 0);

    drawSpark(spark, (snap.spark || []).slice(-120));
  }

  function refreshIfNeeded() {
    if (refreshing) return;
    refreshing = true;
    quoteService
      .ensureFreshSymbol(tabId, symbolSpec, { force: false })
      .then((changed) => {
        if (changed) paint();
      })
      .finally(() => {
        refreshing = false;
      });
  }

  function update() {
    paint();
    refreshIfNeeded();
  }

  function expand() {
    const candles = candleService.getCandles(tabId, symbolSpec, timeframe);
    openTileExpanded({
      symbol: symbolSpec.symbol,
      displayName: symbolSpec.name || symbolSpec.symbol,
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
