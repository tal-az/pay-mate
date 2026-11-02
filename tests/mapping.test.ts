import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { openDb, importStatement, assignMerchant, keepMerchantAsOther, undoMerchant, setCategory } from '../electron/db/db';
import { unknownMerchants, monthTransactions } from '../electron/db/queries';
import type { ParsedStatement, ParsedTransaction } from '../shared/types';

const tx = (over: Partial<ParsedTransaction>): ParsedTransaction => ({
  id: 'x', company: 'isracard', cardLast4: '1234', purchaseDate: '2026-10-01', chargeDate: '2026-10-02',
  rawMerchant: 'x', merchant: 'עסק לא ידוע', originalAmount: 10, originalCurrency: 'ILS',
  chargedAmount: 10, chargedCurrency: 'ILS', voucher: null, standingOrder: false, foreignSite: false,
  discount: 0, details: '', source: 'excel', ...over,
});
const stmt = (transactions: ParsedTransaction[]): ParsedStatement => ({
  company: 'isracard', cardName: '', cardLast4: '1234', month: null, chargeDate: null, statedTotal: null, transactions,
});
const openMem = () => openDb(':memory:', join(__dirname, '../electron/db'));

function seed() {
  const db = openMem();
  importStatement(db, stmt([
    tx({ id: 'a1', merchant: 'חנות א', chargedAmount: 100 }),
    tx({ id: 'a2', merchant: 'חנות א', chargedAmount: 50, purchaseDate: '2026-10-05' }),
    tx({ id: 'b1', merchant: 'חנות ב', chargedAmount: 300 }),
    tx({ id: 'k1', merchant: 'קפה גרג', chargedAmount: 20 }),
    tx({ id: 'n1', merchant: 'חנות א', chargedAmount: 70, chargeDate: '2026-11-02', purchaseDate: '2026-10-20' }),
  ]), 'f', 'excel');
  return db;
}

describe('unknownMerchants', () => {
  it('lists uncategorized businesses in a month, biggest total first, with counts and dates', () => {
    const list = unknownMerchants(seed(), '2026-10');
    expect(list.map((m) => m.merchant)).toEqual(['חנות ב', 'חנות א']);
    expect(list[1]).toMatchObject({ count: 2, total: 150, firstDate: '2026-10-01', lastDate: '2026-10-05' });
  });

  it('skips businesses that already have a category', () => {
    expect(unknownMerchants(seed(), '2026-10').some((m) => m.merchant === 'קפה גרג')).toBe(false);
  });

  it('skips charges the user categorized by hand', () => {
    const db = seed();
    setCategory(db, 'b1', 'health', false);
    expect(unknownMerchants(db, '2026-10').map((m) => m.merchant)).toEqual(['חנות א']);
  });
});

describe('assignMerchant', () => {
  it('maps the business in every month and for future imports', () => {
    const db = seed();
    expect(assignMerchant(db, 'חנות א', 'health')).toBe(3);
    expect(unknownMerchants(db, '2026-10').map((m) => m.merchant)).toEqual(['חנות ב']);
    expect(monthTransactions(db, '2026-11')[0].categoryKey).toBe('health');
    importStatement(db, stmt([tx({ id: 'a9', merchant: 'חנות א' })]), 'g', 'excel');
    expect(monthTransactions(db, '2026-10').find((t) => t.id === 'a9')!.categoryKey).toBe('health');
  });
});

describe('keepMerchantAsOther', () => {
  it('stops asking about the business and leaves it as other', () => {
    const db = seed();
    keepMerchantAsOther(db, 'חנות ב');
    expect(unknownMerchants(db, '2026-10').map((m) => m.merchant)).toEqual(['חנות א']);
    expect(monthTransactions(db, '2026-10').find((t) => t.id === 'b1')!.categoryKey).toBe('other');
  });
});

describe('undoMerchant', () => {
  it('puts an assigned business back to unknown', () => {
    const db = seed();
    assignMerchant(db, 'חנות א', 'health');
    undoMerchant(db, 'חנות א');
    expect(unknownMerchants(db, '2026-10').map((m) => m.merchant)).toContain('חנות א');
    importStatement(db, stmt([tx({ id: 'a9', merchant: 'חנות א' })]), 'g', 'excel');
    expect(monthTransactions(db, '2026-10').find((t) => t.id === 'a9')!.categoryKey).toBe('other');
  });

  it('puts a kept-as-other business back to unknown', () => {
    const db = seed();
    keepMerchantAsOther(db, 'חנות ב');
    undoMerchant(db, 'חנות ב');
    expect(unknownMerchants(db, '2026-10').map((m) => m.merchant)).toContain('חנות ב');
  });
});
