import { describe, expect, it } from 'vitest';
import { categorize } from '../shared/core/categorize';

const cat = (merchant: string, flags: { standingOrder?: boolean; foreignSite?: boolean } = {}) =>
  categorize({ merchant, standingOrder: false, foreignSite: false, ...flags }, []);

describe('categorize keywords', () => {
  it('prefers the longest matching keyword', () => {
    expect(cat('סופר-פארם - קניון')).toBe('health');
    expect(cat('סופר השכונה')).toBe('groceries');
  });

  it('matches short keywords only as whole words', () => {
    expect(cat('פז - תחנה')).toBe('transport');
    expect(cat('ארפזים')).toBe('other');
    expect(cat('שומשום בר בריאות')).toBe('restaurants');
    expect(cat('ברזילי')).toBe('other');
  });

  it('recognizes common food, toll and top-up merchants', () => {
    expect(cat('חומוס נרי')).toBe('restaurants');
    expect(cat('מנהרות הכרמל-זיכוי')).toBe('transport');
    expect(cat('סמי ירקות ופירות')).toBe('groceries');
    expect(cat('חבר כללי')).toBe('loads');
  });
});
