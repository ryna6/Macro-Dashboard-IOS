export const macroConfig = {
  tabs: [
    {
      id: 'global',
      kind: 'macro',
      shortName: 'Global',
      longName: 'Global Markets',
      symbols: [
        { type: 'stock', symbol: 'SPY', name: 'SPY' },
        { type: 'stock', symbol: 'QQQ', name: 'QQQ' },
        { type: 'stock', symbol: 'IEUR', name: 'EU Market ETF' },
        { type: 'stock', symbol: 'EWJ', name: 'JP Market ETF' },
        { type: 'stock', symbol: 'EWH', name: 'HK Market ETF' },
        { type: 'stock', symbol: 'EWC', name: 'CA Market ETF' }
      ]
    },
    {
      id: 'metals',
      kind: 'macro',
      shortName: 'Metals',
      longName: 'Precious Metals',
      symbols: [
        { type: 'stock', symbol: 'GLD', name: 'Gold ETF' },
        { type: 'stock', symbol: 'SLV', name: 'Silver ETF' },
        { type: 'stock', symbol: 'PPLT', name: 'Platinum ETF' },
        { type: 'stock', symbol: 'PALL', name: 'Palladium ETF' }
      ]
    },
    {
      id: 'commo',
      kind: 'macro',
      shortName: 'Commods',
      longName: 'Commodities',
      symbols: [
        { type: 'stock', symbol: 'USO', name: 'Crude Oil' },
        { type: 'stock', symbol: 'BNO', name: 'Brent Crude' },
        { type: 'stock', symbol: 'UNG', name: 'Natural Gas' },
        { type: 'stock', symbol: 'CPER', name: 'Copper' }
      ]
    },
    {
      id: 'rates',
      kind: 'macro',
      shortName: 'Rates',
      longName: 'US & Corporate Bonds',
      symbols: [
        { type: 'stock', symbol: 'SHY', name: '1-3Y Treasury Bond' },
        { type: 'stock', symbol: 'IEF', name: '7-10Y Treasury Bond' },
        { type: 'stock', symbol: 'TLT', name: '20Y+ Treasury Bond' },
        { type: 'stock', symbol: 'HYG', name: 'High Risk Corp Bond' },
        { type: 'stock', symbol: 'LQD', name: 'Low Risk Corp Bond' },
        { type: 'stock', symbol: 'UUP', name: 'US Dollar Index' }
      ]
    },
    {
      id: 'calendar',
      kind: 'calendar',
      shortName: 'Calendar',
      longName: 'US Economic Calendar'
    }
  ]
};
