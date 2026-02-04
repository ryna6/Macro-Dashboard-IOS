import { renderCandlestickChart } from './candlestickChart.js';
import { nyTime } from '../data/time.js';
import { intradayService } from '../data/intradayService.js';

let activeModal = null;

function el(tag, className) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  return n;
}

function fmt2(x) {
  return Number.isFinite(x) ? x.toFixed(2) : '—';
}

function setActiveBtn(row, range) {
  row.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.range === range);
  });
}

export function openTileExpanded({
  tabId,
  symbolSpec,
  symbol,
  displayName,
  initialRange = '1D',
  onClose
}) {
  const sym = String(symbolSpec?.symbol || symbol || '').toUpperCase();
  const name = displayName || symbolSpec?.name || sym;
  const keyName = tabId || symbolSpec?.tabId || 'global';

  if (activeModal) {
    activeModal.destroy();
    activeModal = null;
  }

  const overlay = el('div', 'tile-modal-overlay');
  const panel = el('div', 'tile-modal-panel');

  const header = el('div', 'tile-modal-header');
  const titleWrap = el('div', 'tile-modal-titlewrap');

  const title = el('div', 'tile-modal-title');
  title.textContent = sym;

  const sub = el('div', 'tile-modal-subtitle');
  sub.textContent = name;

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

  // Range row
  const rangeRow = el('div', 'tile-modal-ranges');
  const mkRangeBtn = (label) => {
    const b = el('button', 'tile-modal-rangebtn');
    b.type = 'button';
    b.dataset.range = label;
    b.textContent = label;
    return b;
  };
  const b1d = mkRangeBtn('1D');
  const b1w = mkRangeBtn('1W');
  const b1m = mkRangeBtn('1M');
  rangeRow.appendChild(b1d);
  rangeRow.appendChild(b1w);
  rangeRow.appendChild(b1m);

  const ohlc = el('div', 'tile-modal-ohlc');
  ohlc.textContent = 'Hold & drag on the chart to inspect OHLC';

  const chartWrap = el('div', 'tile-modal-chartwrap');

  panel.appendChild(header);
  panel.appendChild(rangeRow);
  panel.appendChild(ohlc);
  panel.appendChild(chartWrap);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  overlay.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  let chart = null;
  let destroyed = false;
  let currentRange = String(initialRange || '1D');
  let controller = null;

  function setLoading(msg) {
    chartWrap.innerHTML = '';
    const box = el('div', 'tile-modal-empty');
    box.innerHTML = `<div>${msg || 'Loading…'}</div>`;
    chartWrap.appendChild(box);
  }

  function setError(msg) {
    chartWrap.innerHTML = '';
    const box = el('div', 'tile-modal-empty');
    box.innerHTML = `<div>${msg || 'Could not load OHLC data.'}</div>`;
    chartWrap.appendChild(box);
  }

  async function loadRange(range, { force = false } = {}) {
    if (destroyed) return;

    currentRange = range;
    setActiveBtn(rangeRow, range);

    try {
      controller?.abort?.();
    } catch (_) {}
    controller = new AbortController();

    try {
      chart?.destroy?.();
    } catch (_) {}
    chart = null;

    ohlc.textContent = 'Loading OHLC…';
    setLoading('Loading OHLC…');

    let cached = null;
    try {
      cached = intradayService.getCached(keyName, sym, range);
    } catch (_) {}

    const render = (candles) => {
      if (destroyed) return;
      if (!Array.isArray(candles) || candles.length < 2) {
        setError('No OHLC data available for this range.');
        ohlc.textContent = 'No OHLC data available.';
        return;
      }

      chartWrap.innerHTML = '';
      chart = renderCandlestickChart(chartWrap, candles, {
        onHoverCandle: (bar) => {
          if (!bar) {
            ohlc.textContent = 'Hold & drag on the chart to inspect OHLC';
            return;
          }
          const timeStr = nyTime.formatTime(bar.time);
          ohlc.textContent =
            `O ${fmt2(bar.open)}   H ${fmt2(bar.high)}   ` +
            `L ${fmt2(bar.low)}   C ${fmt2(bar.close)}   • ${timeStr} ET`;
        }
      });
    };

    if (cached?.candles?.length) render(cached.candles);

    try {
      const fresh = await intradayService.fetch(keyName, sym, range, { force, signal: controller.signal });
      render(fresh?.candles || []);
    } catch (err) {
      if (cached?.candles?.length) {
        ohlc.textContent = 'Showing cached data (failed to refresh).';
        return;
      }
      const msg = String(err?.message || 'Could not load OHLC data.');
      setError(msg);
      ohlc.textContent = msg;
    }
  }

  function onRangeClick(e) {
    const r = e?.currentTarget?.dataset?.range;
    if (!r || r === currentRange) return;
    loadRange(r, { force: false });
  }

  b1d.addEventListener('click', onRangeClick);
  b1w.addEventListener('click', onRangeClick);
  b1m.addEventListener('click', onRangeClick);

  function destroy() {
    destroyed = true;
    try {
      controller?.abort?.();
    } catch (_) {}
    try {
      chart?.destroy?.();
    } catch (_) {}
    overlay.remove();
    activeModal = null;
  }

  activeModal = { destroy };

  loadRange(currentRange, { force: false });

  return activeModal;
}
