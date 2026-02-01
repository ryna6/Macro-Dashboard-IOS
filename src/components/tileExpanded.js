import { renderCandlestickChart } from './candlestickChart.js';
import { nyTime } from '../data/time.js';

let activeModal = null;

function el(tag, className) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  return n;
}

export function openTileExpanded({
  symbol,
  displayName,
  timeframeLabel,
  candles,
  onClose
}) {
  if (activeModal) {
    activeModal.destroy();
    activeModal = null;
  }

  const overlay = el('div', 'tile-modal-overlay');
  const panel = el('div', 'tile-modal-panel');

  const header = el('div', 'tile-modal-header');
  const titleWrap = el('div', 'tile-modal-titlewrap');

  const title = el('div', 'tile-modal-title');
  title.textContent = symbol;

  const sub = el('div', 'tile-modal-subtitle');
  sub.textContent = displayName ? `${displayName} • ${timeframeLabel}` : timeframeLabel;

  titleWrap.appendChild(title);
  titleWrap.appendChild(sub);

  const closeBtn = el('button', 'tile-modal-close');
  closeBtn.type = 'button';
  closeBtn.textContent = 'Close';

  closeBtn.addEventListener('click', () => {
    destroy();
    onClose?.();
  });

  header.appendChild(titleWrap);
  header.appendChild(closeBtn);

  const ohlc = el('div', 'tile-modal-ohlc');
  ohlc.textContent = 'Hold & drag on the chart to inspect OHLC';

  const chartWrap = el('div', 'tile-modal-chartwrap');

  panel.appendChild(header);
  panel.appendChild(ohlc);
  panel.appendChild(chartWrap);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  overlay.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  const hasCandles = Array.isArray(candles) && candles.length > 0;
  let chart = null;

  if (!hasCandles) {
    // Avoid a blank panel if the candle endpoint is unavailable.
    const empty = el('div', 'tile-modal-empty');
    empty.textContent = 'Candlestick data unavailable. Configure an OHLCV provider for the expanded view.';
    chartWrap.appendChild(empty);
    ohlc.textContent = 'No OHLC data available.';
  } else {
    chart = renderCandlestickChart(chartWrap, candles, {
      onHoverCandle: (bar) => {
        if (!bar) {
          ohlc.textContent = 'Hold & drag on the chart to inspect OHLC';
          return;
        }
        const timeStr = nyTime.formatTime(bar.time);
        ohlc.textContent =
          `O ${bar.open.toFixed(2)}   H ${bar.high.toFixed(2)}   ` +
          `L ${bar.low.toFixed(2)}   C ${bar.close.toFixed(2)}   • ${timeStr} ET`;
      }
    });
  }

  function destroy() {
    try {
      chart?.destroy?.();
    } catch (_) {}
    overlay.remove();
    activeModal = null;
  }

  activeModal = { destroy };
  return activeModal;
}
