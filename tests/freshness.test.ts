import { describe, expect, it } from 'vitest';
import { isStale } from '../src/freshness';

const now = new Date('2026-11-03T12:00:00Z');

describe('isStale', () => {
  it('is false within a day of the last update', () => {
    expect(isStale('2026-11-03T01:00:00Z', now)).toBe(false);
    expect(isStale('2026-11-02T13:00:00Z', now)).toBe(false);
  });
  it('is true after more than a day', () => {
    expect(isStale('2026-11-02T11:00:00Z', now)).toBe(true);
    expect(isStale('2026-10-20T00:00:00Z', now)).toBe(true);
  });
  it('is false when there has never been an update, so the empty state handles it', () => {
    expect(isStale(null, now)).toBe(false);
    expect(isStale(undefined, now)).toBe(false);
  });
});
