import { createHash } from 'node:crypto';

const CURRENCY_BY_SYMBOL: Record<string, string> = {
  '₪': 'ILS',
  '$': 'USD',
  '€': 'EUR',
  '£': 'GBP',
};

export function currencyCode(symbol: unknown): string {
  const s = String(symbol ?? '').trim();
  return CURRENCY_BY_SYMBOL[s] ?? (s.toUpperCase() || 'ILS');
}

/** Removes the issuer's padding and bidi control characters. */
export function cleanText(value: unknown): string {
  return String(value ?? '')
    .replace(/[‎‏‪-‮]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeMerchant(raw: string): string {
  return cleanText(raw).replace(/\s*-\s*$/, '');
}

export function fallbackId(parts: Array<string | number>): string {
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 20);
}
