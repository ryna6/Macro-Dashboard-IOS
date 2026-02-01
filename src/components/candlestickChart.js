import { createChart, CrosshairMode } from 'lightweight-charts';
import { nyTime } from '../data/time.js';

function toSeriesData(candles) {
  return (candles || []).map((c) => ({
    time: c.t,
    open: c.o,
    high: c.h,
    low: c.l,
    close: c.c
  }));
}

export function renderCandlestickChart(container, candles, opts = {}) {
  if (!container) return null;
  container.innerHTML = '';
  container.classList.add('candle-chart-host');

  const data = toSeriesData(candles);

  const chartEl = document.createElement('div');
  chartEl.className = 'candle-chart-inner';
  container.appendChild(chartEl);

  const tip = document.createElement('div');
  tip.className = 'candle-chart-tooltip';
  tip.style.display = 'none';
  container.appendChild(tip);

  const chart = createChart(chartEl, {
    autoSize: true,
    layout: {
      background: { color: 'transparent' },
      textColor: 'rgba(255,255,255,0.85)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
      fontSize: 11
    },
    grid: {
      vertLines: { color: 'rgba(255,255,255,0.06)' },
      horzLines: { color: 'rgba(255,255,255,0.06)' }
    },
    rightPriceScale: { borderVisible: false },
    timeScale: {
      borderVisible: false,
      rightOffset: 2,
      barSpacing: data.length > 400 ? 2.5 : 6
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: 'rgba(255,255,255,0.35)', width: 1 },
      horzLine: { color: 'rgba(255,255,255,0.35)', width: 1 }
    },
    handleScroll: false,
    handleScale: false
  });

  const series = chart.addCandlestickSeries({
    upColor: 'rgba(46, 204, 113, 1)',
    downColor: 'rgba(231, 76, 60, 1)',
    wickUpColor: 'rgba(46, 204, 113, 1)',
    wickDownColor: 'rgba(231, 76, 60, 1)',
    borderVisible: false
  });

  series.setData(data);
  chart.timeScale().fitContent();

  const prevent = (e) => e.preventDefault();
  container.addEventListener('touchmove', prevent, { passive: false });
  container.style.touchAction = 'none';

  let scrubbing = false;

  const showTip = (bar, point) => {
    if (!bar) {
      tip.style.display = 'none';
      opts.onHoverCandle?.(null);
      return;
    }

    opts.onHoverCandle?.(bar);

    const timeStr = nyTime.formatTime(bar.time);
    tip.innerHTML =
      `<div class="t">${timeStr} ET</div>` +
      `<div class="r">O ${bar.open.toFixed(2)}  H ${bar.high.toFixed(2)}</div>` +
      `<div class="r">L ${bar.low.toFixed(2)}  C ${bar.close.toFixed(2)}</div>`;

    tip.style.display = 'block';

    if (point) {
      const rect = container.getBoundingClientRect();
      const x = Math.min(Math.max(8, point.x + 8), rect.width - 140);
      const y = Math.min(Math.max(8, point.y - 48), rect.height - 64);
      tip.style.transform = `translate(${x}px, ${y}px)`;
    }
  };

  chart.subscribeCrosshairMove((param) => {
    if (!param || !param.time || !param.point) {
      if (!scrubbing) showTip(null);
      return;
    }

    const bar = param.seriesData.get(series);
    if (!bar) {
      if (!scrubbing) showTip(null);
      return;
    }

    showTip(bar, param.point);
  });

  container.addEventListener('pointerdown', (e) => {
    scrubbing = true;
    tip.style.display = 'block';
    try {
      container.setPointerCapture(e.pointerId);
    } catch (_) {}
  });

  container.addEventListener('pointerup', () => {
    scrubbing = false;
    tip.style.display = 'none';
    opts.onHoverCandle?.(null);
  });

  container.addEventListener('pointercancel', () => {
    scrubbing = false;
    tip.style.display = 'none';
    opts.onHoverCandle?.(null);
  });

  function destroy() {
    container.removeEventListener('touchmove', prevent);
    chart.remove();
  }

  return { destroy };
}