// src/data/macroConfig.js
export const macroConfig = {
  tabs: [
    {
      id: 'global',
      kind: 'macro',
      shortName: 'Global',
      longName: 'Global Markets',
      symbols: [
        { type: 'stock', symbol: 'SPY' },
        { type: 'stock', symbol: 'QQQ' },
        { type: 'stock', symbol: 'IEUR' },
        { type: 'stock', symbol: 'EWJ' },
        { type: 'stock', symbol: 'EWH' },
        { type: 'stock', symbol: 'XIC' }
      ]
    },
    {
      id: 'metals',
      kind: 'macro',
      shortName: 'Metals',
      longName: 'Precious Metals',
      symbols: [
        { type: 'forex', symbol: 'XAUUSD' },
        { type: 'forex', symbol: 'XAGUSD' },
        { type: 'forex', symbol: 'XPTUSD' },
        { type: 'forex', symbol: 'XPDUSD' }
      ]
    },
    {
      id: 'commo',
      kind: 'macro',
      shortName: 'Commo',
      longName: 'Commodities',
      symbols: [
        { type: 'stock', symbol: 'USO' },
        { type: 'stock', symbol: 'BNO' },
        { type: 'stock', symbol: 'UNG' },
        { type: 'stock', symbol: 'CPER' }
      ]
    },
    {
      id: 'rates',
      kind: 'macro',
      shortName: 'Rates',
      longName: 'Rates',
      symbols: [
        { type: 'stock', symbol: 'SHY' },
        { type: 'stock', symbol: 'IEF' },
        { type: 'stock', symbol: 'TLT' },
        { type: 'stock', symbol: 'HYG' },
        { type: 'stock', symbol: 'LQD' },

        // Attempt DXY first; if it’s problematic, you can swap to UUP in config.
        { type: 'stock', symbol: 'DXY', fallback: 'UUP' }
      ]
    },
    {
      id: 'calendar',
      kind: 'calendar',
      shortName: 'Calendar',
      longName: 'Economic Calendar (US)'
    }
  ]
};
