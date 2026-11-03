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

  describe('flags', () => {
    const flagged = () => {
      const s = open();
      s.importStatement(stmt([tx({ id: 'a', merchant: 'XYZ' }), tx({ id: 'b', merchant: 'ABC' })]), 'f', 'excel');
      return s;
    };

    it('flags a transaction with a comment and shows it on the row and in the list', () => {
      const s = flagged();
      s.setFlag('a', 'suspicious', '  לא זיהיתי  ');
      expect(s.allTransactions().find((t) => t.id === 'a')!.flag).toEqual({ kind: 'suspicious', resolved: false, comment: 'לא זיהיתי' });
      expect(s.allTransactions().find((t) => t.id === 'b')!.flag).toBeUndefined();
      expect(s.flags()).toMatchObject([{ txId: 'a', kind: 'suspicious', comment: 'לא זיהיתי', resolved: false, resolvedAt: null, merchant: 'XYZ' }]);
    });

    it('edits an existing flag without reopening it or changing when it was made', () => {
      const s = flagged();
      s.setFlag('a', 'attention', 'x');
      s.resolveFlag('a', true);
      const before = s.flags()[0];
      s.setFlag('a', 'mistake', 'y');
      const [after] = s.flags();
      expect(s.flags()).toHaveLength(1);
      expect(after).toMatchObject({ kind: 'mistake', comment: 'y', resolved: true, createdAt: before.createdAt });
    });

    it('resolves, reopens and clears', () => {
      const s = flagged();
      s.setFlag('a', 'attention', '');
      s.resolveFlag('a', true);
      expect(s.flags()[0].resolved).toBe(true);
      expect(s.flags()[0].resolvedAt).not.toBeNull();
      s.resolveFlag('a', false);
      expect(s.flags()[0]).toMatchObject({ resolved: false, resolvedAt: null });
      s.clearFlag('a');
      expect(s.flags()).toEqual([]);
      expect(s.allTransactions().find((t) => t.id === 'a')!.flag).toBeUndefined();
    });

    it('rejects an unknown transaction, an unknown kind and a comment that is too long', () => {
      const s = flagged();
      expect(() => s.setFlag('missing', 'attention', '')).toThrow();
      expect(() => s.setFlag('a', 'nope' as never, '')).toThrow();
      expect(() => s.setFlag('a', 'attention', 'x'.repeat(501))).toThrow(/ארוכה/);
      expect(s.flags()).toEqual([]);
    });
  });

  describe('insight flags', () => {
    const insight = { id: 'unusual-a', kind: 'unusual', text: 'חיוב חריג אצל XYZ' };

    it('adds an insight to the list with its own copy of the text, and edits only the comment', () => {
      const s = open();
      s.setInsightFlag('2026-10', insight, ' לבדוק ');
      s.resolveInsightFlag('2026-10:unusual-a', true);
      s.setInsightFlag('2026-10', { ...insight, text: 'changed' }, 'עודכן');
      expect(s.insightFlags()).toMatchObject([
        { key: '2026-10:unusual-a', month: '2026-10', insightKind: 'unusual', text: insight.text, comment: 'עודכן', resolved: true },
      ]);
    });

    it('resolves, reopens and clears', () => {
      const s = open();
      s.setInsightFlag('2026-10', insight, '');
      s.resolveInsightFlag('2026-10:unusual-a', true);
      expect(s.insightFlags()[0].resolvedAt).not.toBeNull();
      s.resolveInsightFlag('2026-10:unusual-a', false);
      expect(s.insightFlags()[0]).toMatchObject({ resolved: false, resolvedAt: null });
      s.clearInsightFlag('2026-10:unusual-a');
      expect(s.insightFlags()).toEqual([]);
    });

    it('keeps the same insight in another month separate', () => {
      const s = open();
      s.setInsightFlag('2026-09', insight, '');
      s.setInsightFlag('2026-10', insight, '');
      expect(s.insightFlags()).toHaveLength(2);
    });

    it('rejects a comment that is too long', () => {
      expect(() => open().setInsightFlag('2026-10', insight, 'x'.repeat(501))).toThrow(/ארוכה/);
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
