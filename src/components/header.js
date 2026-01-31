// src/components/header.js
import { TIMEFRAMES } from '../data/candleService.js';

function el(tag, className) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  return n;
}

function fmtLastUpdated(ms) {
  if (!ms) return 'Last updated —';
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `Last updated ${hh}:${mm}`;
}

export function createHeader({
  onTimeframeChange,
  onRefreshAction
} = {}) {
  const root = el('header', 'app-header');

  const title = el('div', 'app-title');
  title.textContent = 'Macro Dashboard';

  const row = el('div', 'app-subrow');

  const tabName = el('div', 'app-tabname');
  tabName.textContent = '—';

  const controls = el('div', 'app-controls');

  // Timeframe segmented control
  const tfWrap = el('div', 'tf-wrap');

  const tfBtns = [
    { key: TIMEFRAMES.ONE_DAY, label: '1D' },
    { key: TIMEFRAMES.ONE_WEEK, label: '1W' },
    { key: TIMEFRAMES.ONE_MONTH, label: '1M' }
  ].map(({ key, label }) => {
    const b = el('button', 'tf-btn');
    b.type = 'button';
    b.textContent = label;
    b.dataset.tf = key;
    b.addEventListener('click', () => onTimeframeChange?.(key));
    tfWrap.appendChild(b);
    return b;
  });

  // Refresh dropdown
  const dd = el('div', 'dd');
  const ddBtn = el('button', 'dd-btn');
  ddBtn.type = 'button';
  ddBtn.textContent = 'Refresh ▾';

  const ddMenu = el('div', 'dd-menu');
  ddMenu.hidden = true;

  function setMenu(items) {
    ddMenu.innerHTML = '';
    items.forEach((it) => {
      const btn = el('button', 'dd-item');
      btn.type = 'button';
      btn.textContent = it.label;
      btn.addEventListener('click', () => {
        ddMenu.hidden = true;
        onRefreshAction?.(it.action);
      });
      ddMenu.appendChild(btn);
    });
  }

  function openMenu() {
    ddMenu.hidden = false;
  }
  function closeMenu() {
    ddMenu.hidden = true;
  }

  ddBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    ddMenu.hidden ? openMenu() : closeMenu();
  });

  document.addEventListener('click', () => closeMenu());

  dd.appendChild(ddBtn);
  dd.appendChild(ddMenu);

  controls.appendChild(tfWrap);
  controls.appendChild(dd);

  row.appendChild(tabName);
  row.appendChild(controls);

  const updated = el('div', 'app-updated');
  updated.textContent = 'Last updated —';

  root.appendChild(title);
  root.appendChild(row);
  root.appendChild(updated);

  let showTimeframes = true;
  let activeTf = TIMEFRAMES.ONE_DAY;

  function setActiveTf(tf) {
    activeTf = tf;
    tfBtns.forEach((b) => {
      b.classList.toggle('is-active', b.dataset.tf === tf);
    });
  }

  function setTimeframeVisible(visible) {
    showTimeframes = visible;
    tfWrap.style.display = visible ? 'flex' : 'none';
  }

  function setTabLongName(name) {
    tabName.textContent = name || '—';
  }

  function setLastUpdated(ms) {
    updated.textContent = fmtLastUpdated(ms);
  }

  function setRefreshMenuForTab(kind) {
    // kind: "macro" | "calendar"
    if (kind === 'calendar') {
      setMenu([
        { label: 'Refresh calendar', action: 'refresh_calendar' },
        { label: 'Clear calendar cache', action: 'clear_calendar_cache' }
      ]);
    } else {
      setMenu([
        { label: 'Refresh tab', action: 'refresh_tab' },
        { label: 'Refresh all (1–4)', action: 'refresh_all' },
        { label: 'Clear macro cache', action: 'clear_macro_cache' }
      ]);
    }
  }

  // defaults
  setActiveTf(activeTf);
  setRefreshMenuForTab('macro');

  return {
    el: root,
    setActiveTf,
    setTimeframeVisible,
    setTabLongName,
    setLastUpdated,
    setRefreshMenuForTab
  };
}
