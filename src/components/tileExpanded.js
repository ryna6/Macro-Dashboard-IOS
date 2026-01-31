// src/components/tileExpanded.js
import { renderCandlestickChart } from './candlestickChart.js';
import { nyTime } from '../data/time.js';

let activeModal = null;

function el(tag, className) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  return n;
}

/**
 * Open an expanded tile as a popover-style modal.
 * - Does NOT navigate
 * - Does NOT close on backdrop click
 * - ONLY closes via Close button
 */
export function openTileExpanded({
  symbol,
  displayName,
  timeframeLabel,
  candles,          // [{t,o,h,l,c}]
  onClose
}) {
  // Only one at a time
  if (activeModal) {
    activeModal.destroy();
    activeModal = null;
  }

  const overlay = el('div', 'tile-modal-overlay');
  const panel = el('div', 'tile-modal-panel');

  // Header row
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

  // OHLC line (updates while scrubbing)
  const ohlc = el('div', 'tile-modal-ohlc');
  ohlc.textContent = 'Hold & drag on the chart to inspect OHLC';

  // Chart mount
  const chartWrap = el('div', 'tile-modal-chartwrap');

  panel.appendChild(header);
  panel.appendChild(ohlc);
  panel.appendChild(chartWrap);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  // Prevent scroll chaining / overscroll bounce behind the modal
  overlay.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  // Mount chart (candles + crosshair + tooltip)
  const chart = renderCandlestickChart(chartWrap, candles, {
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
