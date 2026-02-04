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

  // Macro Dashboard (largest)
  const title = el('div', 'app-title');
  title.textContent = 'Macro Dashboard';

  // Row with tab name (2nd largest) + controls
  const row = el('div', 'app-subrow');

  const tabName = el('div', 'app-tabname');
  tabName.textContent = '—';

  const controls = el('div', 'app-controls');

  // Timeframe dropdown (single button)
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

  const tfButtons = new Map(); // tf -> button

  tfItems.forEach((it) => {
    const b = el('button', 'dd-item');
    b.type = 'button';
    b.textContent = it.label;
    b.dataset.tf = it.tf;

    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (b.disabled) return;
      tfMenu.hidden = true;
      onTimeframeChange?.(it.tf);
    });

    tfMenu.appendChild(b);
    tfButtons.set(it.tf, b);
  });

  tfBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    tfMenu.hidden = !tfMenu.hidden;
  });

  // Close menus on outside tap
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

  row.appendChild(tabName);
  row.appendChild(controls);

  // Last updated line (small)
  const updated = el('div', 'app-updated');
  updated.textContent = 'Last updated —';

  root.appendChild(title);
  root.appendChild(row);
  root.appendChild(updated);

  let activeTf = TIMEFRAMES.ONE_DAY;

  function setActiveTf(tf) {
    activeTf = tf;
    tfBtn.textContent = `${tfLabel(tf)} ▾`;
  }

  function setTimeframeVisible(visible) {
    tfDD.style.display = visible ? 'block' : 'none';
  }

  function setTimeframeOptionEnabled(tf, enabled) {
    const b = tfButtons.get(tf);
    if (!b) return;
    b.disabled = !enabled;
    b.classList.toggle('is-disabled', !enabled);
  }

  function setTabLongName(name) {
    tabName.textContent = name || '—';
  }

  function setLastUpdated(ms) {
    updated.textContent = formatLastUpdatedET(ms);
  }

  function setRefreshing(isRefreshing) {
    spinner.hidden = !isRefreshing;
    refreshBtn.disabled = !!isRefreshing;
    refreshBtn.classList.toggle('is-loading', !!isRefreshing);
  }

  // defaults
  setActiveTf(activeTf);
  setTimeframeVisible(true);
  setTimeframeOptionEnabled(TIMEFRAMES.ONE_DAY, true);
  setTimeframeOptionEnabled(TIMEFRAMES.ONE_WEEK, true);
  setTimeframeOptionEnabled(TIMEFRAMES.ONE_MONTH, true);

  return {
    el: root,
    setActiveTf,
    setTimeframeVisible,
    setTimeframeOptionEnabled,
    setTabLongName,
    setLastUpdated,
    setRefreshing
  };
}
