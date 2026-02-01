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
        { type: 'forex', symbol: 'XAUUSD', name: 'Gold' },
        { type: 'forex', symbol: 'XAGUSD', name: 'Silver' },
        { type: 'forex', symbol: 'XPTUSD', name: 'Platinum' },
        { type: 'forex', symbol: 'XPDUSD', name: 'Palladium' }
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
        { type: 'stock', symbol: 'SHY', name: '1-3 Year Treasury Bond' },
        { type: 'stock', symbol: 'IEF', name: '7-10 Year Treasury Bond' },
        { type: 'stock', symbol: 'TLT', name: '20+ Year Treasury Bond' },
        { type: 'stock', symbol: 'HYG', name: 'High-Yield Corp Bond (Higher Risk)' },
        { type: 'stock', symbol: 'LQD', name: 'Investment-Grade Corp Bond (Lower Risk)' },
        { type: 'stock', symbol: 'UUP', name: 'US Dollar Index' }
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
