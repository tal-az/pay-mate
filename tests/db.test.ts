import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { openDb, importStatement, setCategory } from '../electron/db/db';
import { lastUpdate } from '../electron/db/queries';
import { categorize } from '../electron/core/categorize';
import type { ParsedStatement, ParsedTransaction } from '../shared/types';

const tx = (over: Partial<ParsedTransaction>): ParsedTransaction => ({
  id: 'isracard:1234:1', company: 'isracard', cardLast4: '1234', purchaseDate: '2026-10-01', chargeDate: '2026-10-02',
  rawMerchant: 'x', merchant: 'שופרסל דיל', originalAmount: 10, originalCurrency: 'ILS',
  chargedAmount: 10, chargedCurrency: 'ILS', voucher: '1', standingOrder: false, foreignSite: false,
  discount: 0, details: '', source: 'excel', ...over,
});
const stmt = (transactions: ParsedTransaction[]): ParsedStatement => ({
  company: 'isracard', cardName: 'x', cardLast4: '1234', month: '2026-10', chargeDate: null, statedTotal: null, transactions,
});
const openMem = () => openDb(':memory:', join(__dirname, '../electron/db'));
const catKeys = (db: ReturnType<typeof openMem>) =>
  (db.prepare('SELECT t.id AS id, c.key AS key FROM transactions t JOIN categories c ON c.id = t.category_id ORDER BY t.id').all() as Array<{ id: string; key: string }>)
    .map((r) => `${r.id}:${r.key}`);

describe('importStatement', () => {
  it('skips transactions that were already imported', () => {
    const db = openMem();
    const s = stmt([tx({ id: 'a' }), tx({ id: 'b', merchant: 'קפה גרג' })]);
    expect(importStatement(db, s, 'f.xlsx', 'excel')).toEqual({ added: 2, skipped: 0 });
    expect(importStatement(db, s, 'f.xlsx', 'excel')).toEqual({ added: 0, skipped: 2 });
    expect((db.prepare('SELECT COUNT(*) AS n FROM transactions').get() as { n: number }).n).toBe(2);
  });
});

describe('categorize', () => {
  it('uses builtin keywords, then standing-order heuristics, then other', () => {
    expect(categorize({ merchant: 'שופרסל דיל', standingOrder: false, foreignSite: false }, [])).toBe('groceries');
    expect(categorize({ merchant: 'XYZ', standingOrder: true, foreignSite: true }, [])).toBe('subscriptions');
    expect(categorize({ merchant: 'XYZ', standingOrder: false, foreignSite: false }, [])).toBe('other');
  });
  it('lets user rules win over builtin ones', () => {
    expect(
      categorize({ merchant: 'שופרסל דיל', standingOrder: false, foreignSite: false }, [
        { pattern: 'שופרסל', categoryKey: 'other' },
      ]),
    ).toBe('other');
  });
});

describe('setCategory', () => {
  it('remembers the choice for the whole merchant and for future imports', () => {
    const db = openMem();
    importStatement(db, stmt([tx({ id: 'a', merchant: 'XYZ' }), tx({ id: 'b', merchant: 'XYZ' })]), 'f', 'excel');
    setCategory(db, 'a', 'health', true);
    expect(catKeys(db)).toEqual(['a:health', 'b:health']);
    importStatement(db, stmt([tx({ id: 'c', merchant: 'XYZ' })]), 'g', 'excel');
    expect(catKeys(db)).toContain('c:health');
  });
  it('changes only one transaction when not applying to the merchant', () => {
    const db = openMem();
    importStatement(db, stmt([tx({ id: 'a', merchant: 'XYZ' }), tx({ id: 'b', merchant: 'XYZ' })]), 'f', 'excel');
    setCategory(db, 'a', 'health', false);
    expect(catKeys(db)).toEqual(['a:health', 'b:other']);
  });
});

describe('lastUpdate', () => {
  it('is null before any import and then reports the latest one', () => {
    const db = openMem();
    expect(lastUpdate(db)).toBeNull();
    importStatement(db, stmt([tx({ id: 'a' })]), 'f', 'excel');
    importStatement(db, stmt([]), 'sync', 'sync');
    const last = lastUpdate(db)!;
    expect(last.source).toBe('sync');
    expect(Date.parse(last.at)).not.toBeNaN();
  });
});
