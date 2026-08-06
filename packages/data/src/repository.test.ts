import { describe, expect, it } from 'vitest';
import { toAssetType, toInstrumentSeed, toUniqueInstrumentSeeds } from './repository';

describe('toAssetType', () => {
  it('classifies Yahoo currency pairs as forex instruments', () => {
    expect(toAssetType('CURRENCY')).toBe('FOREX');
  });
});

describe('toInstrumentSeed', () => {
  it('uses the Yahoo override and preserves ETF classification', () => {
    expect(toInstrumentSeed({
      ticker: 'BRK.B',
      yahooTicker: 'BRK-B',
      name: 'Berkshire Hathaway',
      sleeve: 'ETF',
      currency: 'USD',
    })).toEqual({
      symbol: 'BRK-B',
      name: 'Berkshire Hathaway',
      assetType: 'ETF',
      exchange: 'UNKNOWN',
      currency: 'USD',
      dataSource: 'YAHOO',
      isActive: true,
    });
  });

  it('uses explicit unknown metadata instead of assuming USD', () => {
    expect(toInstrumentSeed({
      ticker: 'ABNB',
      yahooTicker: null,
      name: '',
      sleeve: 'CORE',
      currency: null,
    })).toMatchObject({
      symbol: 'ABNB',
      name: 'ABNB',
      assetType: 'STOCK',
      exchange: 'UNKNOWN',
      currency: 'UNKNOWN',
    });
  });

  it('uses the canonical mapping for ambiguous international symbols', () => {
    expect(toInstrumentSeed({
      ticker: 'AIAI',
      yahooTicker: null,
      name: 'AIAI',
      sleeve: 'ETF',
      currency: 'GBP',
    }).symbol).toBe('AIAI.L');
  });

  it('deduplicates aliases and prefers an exchange-qualified source row', () => {
    expect(toUniqueInstrumentSeeds([
      { ticker: 'REL', yahooTicker: null, name: 'REL alias', sleeve: 'CORE', currency: 'GBP' },
      { ticker: 'REL.L', yahooTicker: null, name: 'REL listing', sleeve: 'CORE', currency: 'GBX' },
    ])).toEqual([
      {
        symbol: 'REL.L',
        name: 'REL listing',
        assetType: 'STOCK',
        exchange: 'UNKNOWN',
        currency: 'GBX',
        dataSource: 'YAHOO',
        isActive: true,
      },
    ]);
  });
});