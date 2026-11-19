import { describe, expect, it } from 'vitest';
import { getDailyThirukural, getThirukuralLines, thirukurals } from './thirukurals.js';

describe('daily Thirukural', () => {
  it('provides 30 complete, numbered entries', () => {
    expect(thirukurals).toHaveLength(30);
    expect(thirukurals.map(({ number }) => number)).toEqual(Array.from({ length: 30 }, (_, index) => index + 1));
    expect(thirukurals.every(({ kural, meaning }) => kural.includes('\n') && meaning.length > 0)).toBe(true);
  });

  it('selects the same entry for a calendar day and advances by day of year', () => {
    expect(getDailyThirukural(new Date(2026, 0, 1))).toEqual(thirukurals[0]);
    expect(getDailyThirukural(new Date(2026, 0, 2))).toEqual(thirukurals[1]);
  });

  it('formats every Kural as four words followed by three words', () => {
    for (const { kural } of thirukurals) {
      const [firstLine, secondLine] = getThirukuralLines(kural);
      expect(firstLine.split(/\s+/)).toHaveLength(4);
      expect(secondLine.split(/\s+/)).toHaveLength(3);
    }
  });
});
