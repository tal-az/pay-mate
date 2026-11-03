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

/**
 * SHA-1 of the UTF-8 text, as lowercase hex. Synchronous so the same code runs in Electron and in a browser
 * (crypto.subtle is async). It only derives ids, so it needs to be stable, not secret.
 */
export function sha1Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const words = new Uint32Array((((bytes.length + 8) >> 6) + 1) * 16);
  for (let i = 0; i < bytes.length; i++) words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
  words[bytes.length >> 2] |= 0x80 << (24 - (bytes.length % 4) * 8);
  words[words.length - 1] = bytes.length * 8;

  const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let block = 0; block < words.length; block += 16) {
    for (let t = 0; t < 16; t++) w[t] = words[block + t];
    for (let t = 16; t < 80; t++) w[t] = rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let t = 0; t < 80; t++) {
      let f: number, k: number;
      if (t < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (t < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (t < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const tmp = (rotl(a, 5) + f + e + k + w[t]) | 0;
      e = d; d = c; c = rotl(b, 30); b = a; a = tmp;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
  }
  return [h0, h1, h2, h3, h4].map((h) => (h >>> 0).toString(16).padStart(8, '0')).join('');
}

export function fallbackId(parts: Array<string | number>): string {
  return sha1Hex(parts.join('|')).slice(0, 20);
}
