import { describe, expect, it } from 'vitest';
import { getDailyQuote, quotes } from './quotes.js';

describe('daily motivation quotes', () => {
  it('contains 30 entries and selects by day of year', () => {
    expect(quotes).toHaveLength(30);
    expect(getDailyQuote(new Date(2026, 0, 1))).toEqual(quotes[0]);
    expect(getDailyQuote(new Date(2026, 0, 2))).toEqual(quotes[1]);
  });

  it('keeps the selection stable for the same calendar day', () => {
    expect(getDailyQuote(new Date(2026, 10, 16))).toEqual(getDailyQuote(new Date(2026, 10, 16)));
  });
});
