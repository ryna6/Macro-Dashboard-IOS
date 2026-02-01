import { renderCandlestickChart } from './candlestickChart.js';
import { TIMEFRAMES } from '../data/candleService.js';
import { nyTime } from '../data/time.js';

function el(tag, className) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  return n;
}

function fmtOHLC(bar) {
  const t = nyTime.formatTs(bar.time);
  return `${t}   O ${bar.open.toFixed(2)}   H ${bar.high.toFixed(2)}   L ${bar.low.toFixed(2)}   C ${bar.close.toFixed(2)}`;
}

function tfLabel(tf) {
  if (tf === TIMEFRAMES.ONE_DAY) return '1D';
  if (tf === TIMEFRAMES.ONE_WEEK) return '1W';
  if (tf === TIMEFRAMES.ONE_MONTH) return '1M';
  return '';
}

export function openTileExpanded({ tabId, symbolSpec, timeframe, candles }) {
  const overlay = el('div', 'tile-modal-overlay');

  // Prevent scroll behind modal
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  const modal = el('div', 'tile-modal');
  overlay.appendChild(modal);

  const header = el('div', 'tile-modal-header');
  const title = el('div', 'tile-modal-title');
  title.textContent = `${symbolSpec.symbol}  ·  ${tfLabel(timeframe)}`;

  const closeBtn = el('button', 'tile-modal-close');
  closeBtn.type = 'button';
  closeBtn.textContent = 'Close';

  closeBtn.addEventListener('click', () => {
    document.body.style.overflow = prevOverflow;
    overlay.remove();
  });

  header.appendChild(title);
  header.appendChild(closeBtn);
  modal.appendChild(header);

  const ohlc = el('div', 'tile-modal-ohlc');
  ohlc.textContent = 'Hold & drag on the chart to inspect OHLC';
  modal.appendChild(ohlc);

  const chartWrap = el('div', 'tile-modal-chartwrap');
  modal.appendChild(chartWrap);

  const hasCandles = Array.isArray(candles) && candles.length >= 2;

  if (!hasCandles) {
    const msg = el('div', 'tile-modal-empty');
    msg.textContent =
      'Candlestick data is not available on your current data plan/provider. ' +
      'Overview tiles are running on Finnhub /quote, but OHLCV candles require a candlestick feed (e.g., Twelve Data, Alpha Vantage, Polygon) or Finnhub premium.';

    chartWrap.appendChild(msg);
  } else {
    renderCandlestickChart(chartWrap, candles, {
      onHoverCandle: (bar) => {
        if (!bar) {
          ohlc.textContent = 'Hold & drag on the chart to inspect OHLC';
          return;
        }
        ohlc.textContent = fmtOHLC(bar);
      }
    });
  }

  overlay.addEventListener('touchmove', (e) => {
    e.preventDefault();
  }, { passive: false });

  document.body.appendChild(overlay);
}
