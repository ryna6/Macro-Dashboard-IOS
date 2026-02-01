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
  const values = points.map((p) => p.p).filter((v) => Number.isFinite(v));
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

export function createTile({ tabId, symbolSpec, timeframe }) {
  const root = el('div', 'tile');
  root.role = 'button';
  root.tabIndex = 0;

  const top = el('div', 'tile-top');
  const logo = el('div', 'tile-logo');

  const logoImg = document.createElement('img');
  logoImg.className = 'tile-logo-img';
  logoImg.alt = '';
  logoImg.loading = 'lazy';

  const logoText = el('div', 'tile-logo-text');
  logoText.textContent = (symbolSpec.symbol || '?').slice(0, 1);

  logo.appendChild(logoImg);
  logo.appendChild(logoText);

  const sym = el('div', 'tile-symbol');
  sym.textContent = symbolSpec.symbol;

  top.appendChild(logo);
  top.appendChild(sym);

  const mid = el('div', 'tile-mid');
  const price = el('div', 'tile-price');
  const change = el('div', 'tile-change');
  mid.appendChild(price);
  mid.appendChild(change);

  // Bottom-right intraday badge (always 1D change)
  const badge = el('div', 'tile-badge');
  badge.textContent = '—';

  const spark = el('canvas', 'tile-spark');
  spark.width = 220;
  spark.height = 64;

  root.appendChild(top);
  root.appendChild(mid);
  root.appendChild(badge);
  root.appendChild(spark);

  function update() {
    const snap = quoteService.getSnapshot(tabId, symbolSpec, timeframe);
    price.textContent = fmtPrice(snap.last);

    const pct = snap.changePct;
    change.textContent = fmtPct(pct);

    // Whole-tile tint based on selected timeframe % change.
    applyTileTint(root, pct);

    // Intraday badge always uses intraday %
    badge.textContent = fmtPct(snap.intradayPct);

    // Logo
    if (snap.logoUrl) {
      logoImg.src = snap.logoUrl;
      logoImg.style.display = 'block';
      logoText.style.display = 'none';
    } else {
      logoImg.style.display = 'none';
      logoText.style.display = 'grid';
    }

    drawSpark(spark, (snap.spark || []).slice(-30));
  }

  function expand() {
    // Candles may be plan-limited. Expanded view still opens as a popup.
    const candles = [];
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

// ---- tinting --------------------------------------------------------------

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function applyTileTint(root, pct) {
  if (!root) return;
  if (pct == null || !Number.isFinite(pct)) {
    root.style.setProperty('--tileTintA', '0.06');
    root.style.setProperty('--tileTintR', '255');
    root.style.setProperty('--tileTintG', '255');
    root.style.setProperty('--tileTintB', '255');
    return;
  }

  const sign = pct >= 0 ? 1 : -1;
  const t = clamp01(Math.abs(pct) / 3.0); // 3% -> max tint
  const a = 0.06 + t * 0.18;              // subtle -> stronger

  const rgb = sign >= 0 ? [32, 197, 94] : [239, 68, 68]; // green / red
  root.style.setProperty('--tileTintA', String(a));
  root.style.setProperty('--tileTintR', String(rgb[0]));
  root.style.setProperty('--tileTintG', String(rgb[1]));
  root.style.setProperty('--tileTintB', String(rgb[2]));
}
