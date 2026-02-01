import { TIMEFRAMES } from '../data/candleService.js';

function el(tag, className) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  return n;
}

function formatLastUpdatedET(ms) {
  if (!ms) return 'Last updated —';
  const t = new Date(ms).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  return `Last updated ${t}`;
}

function tfLabel(tf) {
  if (tf === TIMEFRAMES.ONE_DAY) return '1D';
  if (tf === TIMEFRAMES.ONE_WEEK) return '1W';
  return '1M';
}

export function createHeader({ onTimeframeChange, onRefresh } = {}) {
  const root = el('header', 'app-header');

  // Title (largest)
  const titleEl = el('div', 'app-title');
  titleEl.textContent = 'Macro Dashboard';

  // Row with subtitle + controls
  const row = el('div', 'app-subrow');

  const subtitleEl = el('div', 'app-tabname');
  subtitleEl.textContent = '—';

  const controls = el('div', 'app-controls');

  // Timeframe dropdown
  const tfDD = el('div', 'dd');
  const tfBtn = el('button', 'dd-btn');
  tfBtn.type = 'button';
  tfBtn.textContent = '1D ▾';

  const tfMenu = el('div', 'dd-menu');
  tfMenu.hidden = true;

  const tfItems = [
    { tf: TIMEFRAMES.ONE_DAY, label: '1D' },
    { tf: TIMEFRAMES.ONE_WEEK, label: '1W' },
    { tf: TIMEFRAMES.ONE_MONTH, label: '1M' }
  ];

  tfItems.forEach((it) => {
    const b = el('button', 'dd-item');
    b.type = 'button';
    b.textContent = it.label;
    b.addEventListener('click', () => {
      tfMenu.hidden = true;
      onTimeframeChange?.(it.tf);
    });
    tfMenu.appendChild(b);
  });

  tfBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    tfMenu.hidden = !tfMenu.hidden;
  });

  // Close dropdown on outside click
  document.addEventListener('click', () => {
    tfMenu.hidden = true;
  });

  tfDD.appendChild(tfBtn);
  tfDD.appendChild(tfMenu);

  // Refresh button (no dropdown) + spinner
  const refreshBtn = el('button', 'refresh-btn');
  refreshBtn.type = 'button';

  const refreshText = el('span', 'refresh-text');
  refreshText.textContent = 'Refresh';

  const spinner = el('span', 'spinner');
  spinner.hidden = true;

  refreshBtn.appendChild(refreshText);
  refreshBtn.appendChild(spinner);

  refreshBtn.addEventListener('click', () => onRefresh?.());

  controls.appendChild(tfDD);
  controls.appendChild(refreshBtn);

  row.appendChild(subtitleEl);
  row.appendChild(controls);

  // Last updated line
  const updatedEl = el('div', 'app-updated');
  updatedEl.textContent = 'Last updated —';

  root.appendChild(titleEl);
  root.appendChild(row);
  root.appendChild(updatedEl);

  // Internal state
  let activeTf = TIMEFRAMES.ONE_DAY;

  // Public API
  function setActiveTf(tf) {
    activeTf = tf;
    tfBtn.textContent = `${tfLabel(tf)} ▾`;
  }

  function setTimeframeVisible(visible) {
    tfDD.style.display = visible ? 'block' : 'none';
  }

  function setTabLongName(name) {
    subtitleEl.textContent = name || '—';
  }

  function setLastUpdated(ms) {
    updatedEl.textContent = formatLastUpdatedET(ms);
  }

  function setRefreshing(isRefreshing) {
    spinner.hidden = !isRefreshing;
    refreshBtn.disabled = !!isRefreshing;
    refreshBtn.classList.toggle('is-loading', !!isRefreshing);
  }

  // ---- Compatibility aliases (fixes your console error) ----
  // tabs.js expects these names in some versions.
  function setTitle(text) {
    titleEl.textContent = text || 'Macro Dashboard';
  }

  function setSubtitle(text) {
    setTabLongName(text);
  }

  function setActiveTab(_tabId) {
    // no-op for now (tabbar handles active styling)
  }

  // defaults
  setActiveTf(activeTf);
  setTimeframeVisible(true);

  return {
    el: root,

    // Primary API
    setActiveTf,
    setTimeframeVisible,
    setTabLongName,
    setLastUpdated,
    setRefreshing,

    // Compatibility API
    setTitle,
    setSubtitle,
    setActiveTab
  };
}
