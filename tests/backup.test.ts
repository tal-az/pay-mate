import { describe, expect, it } from 'vitest';
import { BACKUP_VERSION, BackupError, emptyData, makeBackup, parseBackup, type BackupData } from '../shared/backup';
import { restoreData } from '../electron/db/backup';
import { openDb } from '../electron/db/db';
import { join } from 'node:path';
import { sqliteStore, stmt, stores, tx, webStore, type Store } from './helpers/stores';

/** A data set that touches every part of the backup: hand-set categories, rules, reviews, budgets and both sources. */
function populate(s: Store) {
  s.importStatement(stmt([
    tx({ id: 'a1', merchant: 'חנות א', chargedAmount: 100.5 }),
    tx({ id: 'a2', merchant: 'חנות א', chargedAmount: 50, purchaseDate: '2026-10-05' }),
    tx({ id: 'b1', merchant: 'חנות ב', chargedAmount: 300, voucher: null, foreignSite: true, standingOrder: true, discount: 6.55, details: 'אתר חו"ל' }),
    tx({ id: 'k1', merchant: 'קפה גרג', chargedAmount: 20, originalAmount: 5, originalCurrency: 'USD' }),
    tx({ id: 'n1', merchant: 'חנות ג', chargedAmount: -25, chargeDate: null, purchaseDate: '2026-09-20' }),
  ]), 'file.xlsx', 'excel');
  s.importStatement(stmt([tx({ id: 'sync1', merchant: 'חנות ד', source: 'sync' })]), 'סנכרון אוטומטי', 'sync');
  s.assignMerchant('חנות א', 'health');
  s.keepMerchantAsOther('חנות ב');
  s.setCategory('k1', 'entertainment', false);
  s.setBudget('groceries', 700);
  s.setBudget('health', 120.5);
}

/** The two stores order rules, reviews and budgets differently; the content is what must match. */
function normalized(data: BackupData): BackupData {
  const by = <T>(key: (x: T) => string) => (a: T, b: T) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
  return {
    transactions: [...data.transactions].sort(by((t) => t.id)),
    rules: [...data.rules].sort(by((r) => r.pattern)),
    reviews: [...data.reviews].sort(by((r) => r.merchantKey)),
    budgets: [...data.budgets].sort(by((b) => b.categoryKey)),
    imports: data.imports,
  };
}

const roundTrip = (from: Store, to: Store) => to.restoreData(parseBackup(JSON.stringify(makeBackup(from.exportData()))));

describe('backup compatibility between the desktop app and the website', () => {
  const pairs: Array<[string, () => Store, string, () => Store]> = [
    ['sqlite', sqliteStore, 'web', webStore],
    ['web', webStore, 'sqlite', sqliteStore],
    ['sqlite', sqliteStore, 'sqlite', sqliteStore],
    ['web', webStore, 'web', webStore],
  ];

  it.each(pairs)('%s backup restores in %s without losing anything (%s -> %s)', (_a, openFrom, _b, openTo) => {
    const from = openFrom();
    populate(from);
    const to = openTo();
    roundTrip(from, to);

    expect(normalized(to.exportData())).toEqual(normalized(from.exportData()));
    for (const month of from.listMonths()) {
      expect(to.monthSummary(month)).toEqual(from.monthSummary(month));
      expect(to.unknownMerchants(month)).toEqual(from.unknownMerchants(month));
    }
    expect(to.budgets().length).toBe(2);
    expect(to.lastUpdate()).toEqual(from.lastUpdate());
  });

  it.each(pairs)('behaves the same afterwards: re-importing adds nothing, and remembered rules still apply (%s -> %s)', (_a, openFrom, _b, openTo) => {
    const from = openFrom();
    populate(from);
    const to = openTo();
    roundTrip(from, to);

    expect(to.importStatement(stmt([tx({ id: 'a1', merchant: 'חנות א' }), tx({ id: 'sync1', merchant: 'חנות ד', source: 'sync' })]), 'again', 'excel'))
      .toEqual({ added: 0, skipped: 2 });
    to.importStatement(stmt([tx({ id: 'new', merchant: 'חנות א' })]), 'later', 'excel');
    expect(to.allTransactions().find((t) => t.id === 'new')!.categoryKey).toBe('health');
    // The business the user chose to leave as "other" is still not asked about.
    expect(to.unknownMerchants('2026-10').map((m) => m.merchant)).not.toContain('חנות ב');
  });

  it('keeps the locked flag, so a business-wide change still skips hand-set charges after a restore', () => {
    for (const [, open] of stores) {
      const to = open();
      roundTrip((() => { const f = sqliteStore(); populate(f); return f; })(), to);
      to.assignMerchant('קפה גרג', 'restaurants');
      expect(to.allTransactions().find((t) => t.id === 'k1')!.categoryKey).toBe('entertainment');
    }
  });

  it('replaces whatever was there before', () => {
    const from = sqliteStore();
    populate(from);
    const to = webStore();
    to.importStatement(stmt([tx({ id: 'old' })]), 'old', 'excel');
    roundTrip(from, to);
    expect(to.allTransactions().some((t) => t.id === 'old')).toBe(false);
  });
});

describe('parseBackup', () => {
  const valid = () => JSON.parse(JSON.stringify(makeBackup((() => { const s = webStore(); populate(s); return s.exportData(); })())));
  const parse = (o: unknown) => parseBackup(JSON.stringify(o));

  it('accepts what makeBackup writes', () => {
    expect(parse(valid()).transactions).toHaveLength(6);
  });

  it('rejects text that is not a PayMate backup, with a message for the user', () => {
    for (const bad of ['', 'not json', '[]', '{"format":"other"}', '{}']) {
      expect(() => parseBackup(bad), bad).toThrow(BackupError);
    }
  });

  it('rejects a backup from a newer version', () => {
    expect(() => parse({ ...valid(), version: BACKUP_VERSION + 1 })).toThrow(/חדשה יותר/);
  });

  it('rejects damaged transactions instead of importing part of them', () => {
    const noId = valid();
    delete noId.transactions[0].id;
    expect(() => parse(noId)).toThrow(BackupError);
    const badAmount = valid();
    badAmount.transactions[0].chargedAmount = 'a lot';
    expect(() => parse(badAmount)).toThrow(BackupError);
    const badDate = valid();
    badDate.transactions[0].purchaseDate = '01/10/2026';
    expect(() => parse(badDate)).toThrow(BackupError);
  });

  it('maps a category this version does not know to "other" and drops rules and budgets that use it', () => {
    const b = valid();
    b.transactions[0].categoryKey = 'from-the-future';
    b.rules.push({ pattern: 'x', categoryKey: 'from-the-future', origin: 'user' });
    b.budgets.push({ categoryKey: 'from-the-future', monthlyAmount: 5 });
    const data = parse(b);
    expect(data.transactions[0].categoryKey).toBe('other');
    expect(data.rules.some((r) => r.pattern === 'x')).toBe(false);
    expect(data.budgets.some((x) => x.categoryKey === 'from-the-future')).toBe(false);
  });

  it('ignores duplicate ids and zero budgets', () => {
    const b = valid();
    b.transactions.push({ ...b.transactions[0] });
    b.budgets.push({ categoryKey: 'bills', monthlyAmount: 0 });
    const data = parse(b);
    expect(data.transactions).toHaveLength(6);
    expect(data.budgets.some((x) => x.categoryKey === 'bills')).toBe(false);
  });

  it('reads an empty backup', () => {
    expect(parse(makeBackup(emptyData()))).toEqual(emptyData());
  });
});

describe('a failed restore changes nothing', () => {
  it('on the desktop database', () => {
    const db = openDb(':memory:', join(__dirname, '../electron/db'));
    const s = sqliteStore();
    populate(s);
    const data = s.exportData();
    restoreData(db, data);
    // Duplicate ids are rejected by the database part-way through, after the old rows were deleted.
    const broken: BackupData = { ...data, transactions: [data.transactions[0], data.transactions[0]] };
    expect(() => restoreData(db, broken)).toThrow();
    const count = (db.prepare('SELECT COUNT(*) AS n FROM transactions').get() as { n: number }).n;
    expect(count).toBe(data.transactions.length);
  });
});
