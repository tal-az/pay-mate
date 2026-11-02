import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JavaScript module without type declarations
import { pickVersion } from '../scripts/pick-scraper-version.mjs';

const now = new Date('2026-11-10T00:00:00Z');
const days = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
const pick = (pinned: string, times: Record<string, string>) => pickVersion({ pinned, times, now }) as string | null;

describe('pickVersion', () => {
  it('adopts the newest stable version that is at least 7 days old', () => {
    expect(pick('6.12.2', { '6.12.2': days(60), '6.12.3': days(20), '6.13.0': days(8), '6.13.1': days(2) })).toBe('6.13.0');
  });

  it('waits when the only newer version is too fresh', () => {
    expect(pick('6.12.2', { '6.12.2': days(60), '6.12.3': days(6) })).toBeNull();
  });

  it('never jumps to a new major version', () => {
    expect(pick('6.12.2', { '6.12.2': days(60), '7.0.0': days(30) })).toBeNull();
  });

  it('ignores pre-releases, older versions and registry metadata keys', () => {
    expect(
      pick('6.12.2', {
        created: days(900), modified: days(1), '6.11.0': days(100), '6.12.2': days(60),
        '6.13.0-beta.1': days(30), '6.12.10': days(10),
      }),
    ).toBe('6.12.10');
  });

  it('compares versions numerically, not as text', () => {
    expect(pick('6.9.0', { '6.9.0': days(90), '6.10.0': days(30), '6.9.5': days(30) })).toBe('6.10.0');
  });

  it('returns null for a pinned value that is not an exact version', () => {
    expect(pick('^6.12.2', { '6.13.0': days(30) })).toBeNull();
  });
});
