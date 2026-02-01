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
  // Keep it clean: 2 decimals, but avoid trailing .00 for large ETFs if you want later.
  return x.toFixed(2);
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

  const ys = points.map(p => p.p).filter(Number.isFinite);
  if (ys.length < 2) return;

  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const range = (maxY - minY) || 1;

  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 1;

  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const x = (i / (points.length - 1)) * (w - 2) + 1;
    const y = h - 1 - ((points[i].p - minY) / range) * (h - 2);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

export function createTile({ tabId, symbolSpec, timeframe }) {
  let tf = timeframe;

  const root = el('button', 'tile');
  root.type = 'button';

  const top = el('div', 'tile-top');
  const id = el('div', 'tile-id');

  const logoWrap = el('div', 'tile-logo');
  if (symbolSpec.logoUrl) {
    const img = el('img');
    img.alt = symbolSpec.symbol;
    img.src = symbolSpec.logoUrl;
    logoWrap.appendChild(img);
  } else {
    logoWrap.textContent = symbolSpec.symbol.slice(0, 1);
  }

  const sym = el('div', 'tile-sym');
  sym.textContent = symbolSpec.symbol;

  id.appendChild(logoWrap);
  id.appendChild(sym);

  const price = el('div', 'tile-price');
  const chg = el('div', 'tile-chg');

  top.appendChild(id);
  top.appendChild(price);
  top.appendChild(chg);

  const sparkWrap = el('div', 'tile-spark');
  const canvas = el('canvas');
  canvas.width = 180;
  canvas.height = 44;
  sparkWrap.appendChild(canvas);

  root.appendChild(top);
  root.appendChild(sparkWrap);

  function render() {
    const snap = quoteService.getSnapshot(tabId, symbolSpec, tf);
    price.textContent = fmtPrice(snap.last);
    chg.textContent = fmtPct(snap.changePct);

    chg.classList.toggle('pos', (snap.changePct ?? 0) > 0);
    chg.classList.toggle('neg', (snap.changePct ?? 0) < 0);

    drawSpark(canvas, snap.spark);
  }

  async function expand() {
    // Candles are optional now; if premium is missing, this will fail and expanded view will show a friendly message.
    let candles = [];
    try {
      candles = await candleService.getCandles(tabId, symbolSpec, tf);
    } catch {
      candles = [];
    }

    openTileExpanded({
      tabId,
      symbolSpec,
      timeframe: tf,
      candles
    });
  }

  root.addEventListener('click', expand);

  return {
    el: root,
    update: render,
    setTimeframe: (nextTf) => { tf = nextTf; render(); }
  };
}
