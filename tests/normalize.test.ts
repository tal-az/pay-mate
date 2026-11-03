import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { fallbackId, sha1Hex } from '../shared/core/normalize';

const reference = (text: string) => createHash('sha1').update(text).digest('hex');

describe('sha1Hex', () => {
  it('matches node:crypto, so ids stay the same as in existing data', () => {
    const samples = [
      '', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(65), 'x'.repeat(1000),
      '2026-10-01|קפה לדוגמה|40|40', 'APPLE.COM/BILL|11.9', '€₪ 😀 ñ',
    ];
    for (const s of samples) expect(sha1Hex(s)).toBe(reference(s));
  });

  it('derives the same fallback id as before', () => {
    const parts = ['2026-10-01', 'קפה לדוגמה', 40, 40];
    expect(fallbackId(parts)).toBe(reference(parts.join('|')).slice(0, 20));
  });
});
