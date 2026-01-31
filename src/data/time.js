// src/data/time.js
const TZ = 'America/New_York';

const dtfParts = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
});

const dtfTime = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit'
});

const dtfWeekday = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  weekday: 'long'
});

function partsFromMs(ms) {
  const parts = dtfParts.formatToParts(new Date(ms));
  const obj = {};
  for (const p of parts) {
    if (p.type !== 'literal') obj[p.type] = p.value;
  }
  return {
    year: Number(obj.year),
    month: Number(obj.month),
    day: Number(obj.day),
    hour: Number(obj.hour),
    minute: Number(obj.minute),
    second: Number(obj.second),
    weekdayShort: obj.weekday
  };
}

function getTzOffsetMs(dateMs) {
  // Offset = (NY-represented-as-UTC) - actual UTC
  const p = partsFromMs(dateMs);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUTC - dateMs;
}

function zonedToUtcMs({ year, month, day, hour, minute, second }) {
  // iterative correction to handle DST boundaries correctly
  let guess = Date.UTC(year, month - 1, day, hour, minute, second);
  let offset = getTzOffsetMs(guess);
  let corrected = guess - offset;

  // one more pass
  offset = getTzOffsetMs(corrected);
  corrected = guess - offset;

  return corrected;
}

export const nyTime = {
  parts(tSec) {
    return partsFromMs(tSec * 1000);
  },

  ymd(tSec) {
    const p = partsFromMs(tSec * 1000);
    const m = String(p.month).padStart(2, '0');
    const d = String(p.day).padStart(2, '0');
    return `${p.year}-${m}-${d}`;
  },

  isWeekend(tSec) {
    const p = partsFromMs(tSec * 1000);
    // weekdayShort: Sun, Mon, Tue...
    return p.weekdayShort === 'Sat' || p.weekdayShort === 'Sun';
  },

  zonedToUtcSec(parts) {
    return Math.floor(zonedToUtcMs(parts) / 1000);
  },

  formatTime(tSec) {
    return dtfTime.format(new Date(tSec * 1000));
  },

  weekdayName(tSec) {
    return dtfWeekday.format(new Date(tSec * 1000));
  },

  /**
   * For Finnhub economic calendar times:
   * Some clients return a string, some return ISO-ish; handle both.
   */
  parseEventTimeToSec(timeVal) {
    if (!timeVal) return 0;

    // If it's already a number-like timestamp:
    if (typeof timeVal === 'number') return Math.floor(timeVal);

    const s = String(timeVal);

    // Common Finnhub examples: "2020-06-02 01:30:00" (assume ET-like schedule)
    // We'll parse as if it is in ET by converting ET parts to UTC.
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (m) {
      const year = Number(m[1]);
      const month = Number(m[2]);
      const day = Number(m[3]);
      const hour = Number(m[4]);
      const minute = Number(m[5]);
      const second = Number(m[6] || 0);
      return Math.floor(zonedToUtcMs({ year, month, day, hour, minute, second }) / 1000);
    }

    // Fallback to Date parsing
    const d = new Date(s);
    if (Number.isFinite(d.getTime())) return Math.floor(d.getTime() / 1000);
    return 0;
  },

  /**
   * Build a Date object representing ET-local parts (used for weekly schedule logic).
   * (Internally stored as a Date in your local JS environment, but with ET values.)
   */
  zonedDateFromParts(p) {
    // Create a string "MM/DD/YYYY, HH:MM:SS" and parse in JS local –
    // This matches the MarketDB approach. Good enough for weekly scheduling UI.
    const mm = String(p.month).padStart(2, '0');
    const dd = String(p.day).padStart(2, '0');
    const hh = String(p.hour).padStart(2, '0');
    const mi = String(p.minute).padStart(2, '0');
    const ss = String(p.second).padStart(2, '0');
    return new Date(`${mm}/${dd}/${p.year}, ${hh}:${mi}:${ss}`);
  }
};
