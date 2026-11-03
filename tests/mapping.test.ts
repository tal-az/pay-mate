import { describe, expect, it } from 'vitest';
import { stmt, stores, tx } from './helpers/stores';

describe.each(stores)('%s store: business mapping', (_name, open) => {
  const unknownTx = (over: Parameters<typeof tx>[0]) => tx({ merchant: 'עסק לא ידוע', voucher: null, ...over });

  function seed() {
    const s = open();
    s.importStatement(stmt([
      unknownTx({ id: 'a1', merchant: 'חנות א', chargedAmount: 100 }),
      unknownTx({ id: 'a2', merchant: 'חנות א', chargedAmount: 50, purchaseDate: '2026-10-05' }),
      unknownTx({ id: 'b1', merchant: 'חנות ב', chargedAmount: 300 }),
      unknownTx({ id: 'k1', merchant: 'קפה גרג', chargedAmount: 20 }),
      unknownTx({ id: 'n1', merchant: 'חנות א', chargedAmount: 70, chargeDate: '2026-11-02', purchaseDate: '2026-10-20' }),
    ]), 'f', 'excel');
    return s;
  }
  const catOf = (s: ReturnType<typeof open>, month: string, id: string) => s.monthTransactions(month).find((t) => t.id === id)!.categoryKey;

  describe('unknownMerchants', () => {
    it('lists uncategorized businesses in a month, biggest total first, with counts and dates', () => {
      const list = seed().unknownMerchants('2026-10');
      expect(list.map((m) => m.merchant)).toEqual(['חנות ב', 'חנות א']);
      expect(list[1]).toMatchObject({ count: 2, total: 150, firstDate: '2026-10-01', lastDate: '2026-10-05' });
    });

    it('skips businesses that already have a category', () => {
      expect(seed().unknownMerchants('2026-10').some((m) => m.merchant === 'קפה גרג')).toBe(false);
    });

    it('skips charges the user categorized by hand', () => {
      const s = seed();
      s.setCategory('b1', 'health', false);
      expect(s.unknownMerchants('2026-10').map((m) => m.merchant)).toEqual(['חנות א']);
    });
  });

  describe('assignMerchant', () => {
    it('maps the business in every month and for future imports', () => {
      const s = seed();
      expect(s.assignMerchant('חנות א', 'health')).toBe(3);
      expect(s.unknownMerchants('2026-10').map((m) => m.merchant)).toEqual(['חנות ב']);
      expect(s.monthTransactions('2026-11')[0].categoryKey).toBe('health');
      s.importStatement(stmt([unknownTx({ id: 'a9', merchant: 'חנות א' })]), 'g', 'excel');
      expect(catOf(s, '2026-10', 'a9')).toBe('health');
    });

    it('leaves hand-categorized charges alone', () => {
      const s = seed();
      s.setCategory('a1', 'clothing', false);
      expect(s.assignMerchant('חנות א', 'health')).toBe(2);
      expect(catOf(s, '2026-10', 'a1')).toBe('clothing');
    });
  });

  describe('keepMerchantAsOther', () => {
    it('stops asking about the business and leaves it as other', () => {
      const s = seed();
      s.keepMerchantAsOther('חנות ב');
      expect(s.unknownMerchants('2026-10').map((m) => m.merchant)).toEqual(['חנות א']);
      expect(catOf(s, '2026-10', 'b1')).toBe('other');
    });
  });

  describe('undoMerchant', () => {
    it('puts an assigned business back to unknown', () => {
      const s = seed();
      s.assignMerchant('חנות א', 'health');
      s.undoMerchant('חנות א');
      expect(s.unknownMerchants('2026-10').map((m) => m.merchant)).toContain('חנות א');
      s.importStatement(stmt([unknownTx({ id: 'a9', merchant: 'חנות א' })]), 'g', 'excel');
      expect(catOf(s, '2026-10', 'a9')).toBe('other');
    });

    it('puts a kept-as-other business back to unknown', () => {
      const s = seed();
      s.keepMerchantAsOther('חנות ב');
      s.undoMerchant('חנות ב');
      expect(s.unknownMerchants('2026-10').map((m) => m.merchant)).toContain('חנות ב');
    });
  });
});
