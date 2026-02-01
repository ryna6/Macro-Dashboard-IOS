import { quoteService } from '../data/quoteService.js';
import { candleService } from '../data/candleService.js';
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
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  if (!Array.isArray(points) || points.length < 2) return;

  const ys = points.map((p) => p.p).filter((v) => Number.isFinite(v));
  if (ys.length < 2) return;

  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const range = max - min || 1;

  ctx.lineWidth = 1.5;
  ctx.beginPath();

  for (let i = 0; i < points.length; i++) {
    const x = (i / (points.length - 1)) * (w - 2) + 1;
    const y = h - ((points[i].p - min) / range) * (h - 2) - 1;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.65)';
  ctx.stroke();
}

export function createTile({ tabId, symbolSpec, timeframe }) {
  let tf = timeframe;

  // Use a DIV instead of <button> to avoid default button appearance quirks
  const root = el('div', 'tile');
  root.role = 'button';
  root.tabIndex = 0;

  // Top row: logo + symbol
  const top = el('div', 'tile-top');

  const logo = el('div', 'tile-logo');
  if (symbolSpec.logoUrl) {
    const img = document.createElement('img');
    img.alt = symbolSpec.symbol;
    img.src = symbolSpec.logoUrl;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.borderRadius = '999px';
    logo.textContent = '';
    logo.appendChild(img);
  } else {
    logo.textContent = (symbolSpec.symbol || '?').slice(0, 1);
  }

  const sym = el('div', 'tile-symbol');
  sym.textContent = symbolSpec.symbol;

  top.appendChild(logo);
  top.appendChild(sym);

  // Mid row: price + % change
  const mid = el('div', 'tile-mid');
  const price = el('div', 'tile-price');
  const change = el('div', 'tile-change');
  mid.appendChild(price);
  mid.appendChild(change);

  // Sparkline canvas (CSS expects .tile-spark on the canvas)
  const spark = el('canvas', 'tile-spark');
  spark.width = 220;
  spark.height = 38;

  root.appendChild(top);
  root.appendChild(mid);
  root.appendChild(spark);

  function update() {
    const snap = quoteService.getSnapshot(tabId, symbolSpec, tf);

    price.textContent = fmtPrice(snap.last);

    const pct = snap.changePct;
    change.textContent = fmtPct(pct);
    change.classList.toggle('is-up', pct != null && pct > 0);
    change.classList.toggle('is-down', pct != null && pct < 0);

    drawSpark(spark, snap.spark || []);
  }

  function expand() {
    // Candles are optional; if unavailable, expanded view shows empty-state message (per your tileExpanded.js)
    const candles = candleService.getCandles?.(tabId, symbolSpec, tf) || [];
    openTileExpanded({
      tabId,
      symbolSpec,
      timeframe: tf,
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

  // initial
  update();

  return {
    el: root,
    update,
    setTimeframe: (nextTf) => {
      tf = nextTf;
      update();
    }
  };
}
