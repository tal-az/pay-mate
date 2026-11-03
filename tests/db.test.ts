import { describe, expect, it } from 'vitest';
import { categorize } from '../shared/core/categorize';
import { stmt, stores, tx } from './helpers/stores';

describe.each(stores)('%s store', (_name, open) => {
  const catKeys = (s: ReturnType<typeof open>) => s.allTransactions().map((t) => `${t.id}:${t.categoryKey}`).sort();

  describe('importStatement', () => {
    it('skips transactions that were already imported', () => {
      const s = open();
      const st = stmt([tx({ id: 'a' }), tx({ id: 'b', merchant: 'קפה גרג' })]);
      expect(s.importStatement(st, 'f.xlsx', 'excel')).toEqual({ added: 2, skipped: 0 });
      expect(s.importStatement(st, 'f.xlsx', 'excel')).toEqual({ added: 0, skipped: 2 });
      expect(s.allTransactions()).toHaveLength(2);
    });

    it('ignores a duplicate id inside one statement', () => {
      const s = open();
      expect(s.importStatement(stmt([tx({ id: 'a' }), tx({ id: 'a' })]), 'f', 'excel')).toEqual({ added: 1, skipped: 1 });
    });
  });

  describe('setCategory', () => {
    it('remembers the choice for the whole merchant and for future imports', () => {
      const s = open();
      s.importStatement(stmt([tx({ id: 'a', merchant: 'XYZ' }), tx({ id: 'b', merchant: 'XYZ' })]), 'f', 'excel');
      s.setCategory('a', 'health', true);
      expect(catKeys(s)).toEqual(['a:health', 'b:health']);
      s.importStatement(stmt([tx({ id: 'c', merchant: 'XYZ' })]), 'g', 'excel');
      expect(catKeys(s)).toContain('c:health');
    });

    it('changes only one transaction when not applying to the merchant', () => {
      const s = open();
      s.importStatement(stmt([tx({ id: 'a', merchant: 'XYZ' }), tx({ id: 'b', merchant: 'XYZ' })]), 'f', 'excel');
      s.setCategory('a', 'health', false);
      expect(catKeys(s)).toEqual(['a:health', 'b:other']);
    });

    it('rejects an unknown category or transaction', () => {
      const s = open();
      s.importStatement(stmt([tx({ id: 'a' })]), 'f', 'excel');
      expect(() => s.setCategory('a', 'nope', false)).toThrow();
      expect(() => s.setCategory('missing', 'health', false)).toThrow();
    });
  });

  describe('lastUpdate', () => {
    it('is null before any import and then reports the latest one', () => {
      const s = open();
      expect(s.lastUpdate()).toBeNull();
      s.importStatement(stmt([tx({ id: 'a' })]), 'f', 'excel');
      s.importStatement(stmt([]), 'sync', 'sync');
      const last = s.lastUpdate()!;
      expect(last.source).toBe('sync');
      expect(Date.parse(last.at)).not.toBeNaN();
    });
  });

  describe('budgets', () => {
    it('sets, replaces and clears a budget', () => {
      const s = open();
      s.setBudget('groceries', 700);
      s.setBudget('groceries', 800);
      s.setBudget('health', 100);
      expect(s.budgets().sort((a, b) => a.categoryKey.localeCompare(b.categoryKey))).toEqual([
        { categoryKey: 'groceries', monthlyAmount: 800 },
        { categoryKey: 'health', monthlyAmount: 100 },
      ]);
      s.setBudget('groceries', null);
      expect(s.budgets()).toEqual([{ categoryKey: 'health', monthlyAmount: 100 }]);
    });
  });

  describe('monthSummary', () => {
    it('totals a month by category and compares with the previous one', () => {
      const s = open();
      s.importStatement(stmt([
        tx({ id: 'a', merchant: 'שופרסל דיל', chargedAmount: 100 }),
        tx({ id: 'b', merchant: 'קפה גרג', chargedAmount: 30 }),
        tx({ id: 'c', merchant: 'שופרסל דיל', chargedAmount: 50, chargeDate: '2026-09-02', purchaseDate: '2026-08-20' }),
      ]), 'f', 'excel');
      const sum = s.monthSummary('2026-10');
      expect(sum).toMatchObject({ total: 130, prevMonth: '2026-09', prevTotal: 50, transactionCount: 2, cards: ['1234'] });
      expect(sum.byCategory.map((c) => [c.key, c.amount])).toEqual([['groceries', 100], ['restaurants', 30]]);
      expect(s.listMonths()).toEqual(['2026-10', '2026-09']);
    });
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
