import { describe, expect, it } from 'vitest';
import { parseBackup, makeBackup } from '../shared/backup';
import { stmt, stores, tx } from './helpers/stores';

describe.each(stores)('custom categories (%s)', (_name, make) => {
  it('adds a category that can then be used for merchants, budgets and totals', () => {
    const s = make();
    const pets = s.addCategory('  חיות   מחמד ', '#2A78D6');
    expect(pets).toMatchObject({ name: 'חיות מחמד', color: '#2a78d6' });
    expect(s.categories().map((c) => c.key)).toContain(pets.key);

    s.importStatement(stmt([tx({ id: 'p1', merchant: 'פט שופ', chargedAmount: 80 })]), 'f', 'excel');
    s.assignMerchant('פט שופ', pets.key);
    s.setBudget(pets.key, 200);
    const summary = s.monthSummary('2026-10');
    expect(summary.byCategory.find((c) => c.key === pets.key)).toMatchObject({ name: 'חיות מחמד', amount: 80 });
    expect(s.budgets()).toEqual([{ categoryKey: pets.key, monthlyAmount: 200 }]);
  });

  it('rejects empty, duplicate and badly colored categories', () => {
    const s = make();
    expect(() => s.addCategory('   ', '#2a78d6')).toThrow();
    expect(() => s.addCategory('תרומות', '#2a78d6')).toThrow('כבר יש');
    expect(() => s.addCategory('x'.repeat(31), '#2a78d6')).toThrow('ארוך');
    expect(() => s.addCategory('חדשה', 'red')).toThrow();
    s.addCategory('חדשה', '#2a78d6');
    expect(() => s.addCategory('חדשה', '#eb6834')).toThrow('כבר יש');
  });

  it('keeps custom categories through a backup and replaces them on restore', () => {
    const a = make();
    const pets = a.addCategory('חיות מחמד', '#2a78d6');
    a.importStatement(stmt([tx({ id: 'p1', merchant: 'פט שופ' })]), 'f', 'excel');
    a.assignMerchant('פט שופ', pets.key);

    const file = JSON.stringify(makeBackup(a.exportData()));
    const parsed = parseBackup(file);
    expect(parsed.categories).toEqual([{ key: pets.key, name: 'חיות מחמד', color: '#2a78d6' }]);

    const b = make();
    b.addCategory('אחרת לגמרי', '#eb6834');
    b.restoreData(parsed);
    expect(b.categories().filter((c) => c.key.startsWith('custom-')).map((c) => c.name)).toEqual(['חיות מחמד']);
    expect(b.allTransactions()[0].categoryKey).toBe(pets.key);
  });
});
