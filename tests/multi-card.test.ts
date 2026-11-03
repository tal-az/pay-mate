import { describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importStatement, openDb } from '../electron/db/db';
import { listCards } from '../electron/db/queries';
import { makeBackup, parseBackup } from '../shared/backup';
import { buildInsights, insightsFor, recurringTimeline } from '../shared/core/insights';
import { byCompany, cardLabel } from '../shared/core/cards';
import type { TxRow } from '../shared/api';
import { stmt, stores, tx } from './helpers/stores';

describe.each(stores)('several cards in the %s store', (_name, open) => {
  const three = () => {
    const s = open();
    s.importStatement(stmt([
      tx({ id: 'isracard:1234:1', chargedAmount: 100 }),
      tx({ id: 'isracard:1234:2', chargedAmount: 40, chargeDate: '2026-09-02', purchaseDate: '2026-08-20' }),
    ]), 'f', 'excel');
    s.importStatement({ ...stmt([tx({ id: 'max:1234:1', company: 'max', chargedAmount: 30 })]), company: 'max' }, 'סנכרון', 'sync');
    s.importStatement({ ...stmt([tx({ id: 'max:5678:1', company: 'max', cardLast4: '5678', chargedAmount: 200 })]), company: 'max', cardLast4: '5678' }, 'סנכרון', 'sync');
    return s;
  };

  it('adds every card up in the combined view', () => {
    const sum = three().monthSummary('2026-10');
    expect(sum.total).toBe(330);
    expect(sum.byCard.map((c) => [c.key, c.amount, c.count])).toEqual([['max:5678', 200, 1], ['isracard:1234', 100, 1], ['max:1234', 30, 1]]);
  });

  it('keeps cards with the same last four digits apart', () => {
    const s = three();
    const rows = s.monthTransactions('2026-10', 'max:1234');
    expect(rows.map((t) => t.id)).toEqual(['max:1234:1']);
    expect(rows[0].company).toBe('max');
    expect(s.monthSummary('2026-10', 'isracard:1234').total).toBe(100);
  });

  it('compares one card with its own previous month', () => {
    const s = three();
    expect(s.monthSummary('2026-10', 'isracard:1234')).toMatchObject({ prevMonth: '2026-09', prevTotal: 40 });
    expect(s.monthSummary('2026-10', 'max:1234')).toMatchObject({ prevMonth: null, prevTotal: null });
  });

  it('lists the cards, each with the last update of its own company', () => {
    vi.useFakeTimers();
    try {
      const s = open();
      vi.setSystemTime(new Date('2026-10-01T10:00:00Z'));
      s.importStatement(stmt([tx({ id: 'a' })]), 'f', 'excel');
      vi.setSystemTime(new Date('2026-10-05T10:00:00Z'));
      s.importStatement({ ...stmt([tx({ id: 'b', company: 'max', cardLast4: '5678' })]), company: 'max', cardLast4: '5678' }, 'סנכרון', 'sync');
      expect(s.cards()).toEqual([
        { key: 'isracard:1234', company: 'isracard', last4: '1234', updatedAt: '2026-10-01T10:00:00.000Z' },
        { key: 'max:5678', company: 'max', last4: '5678', updatedAt: '2026-10-05T10:00:00.000Z' },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the company of an import through a backup', () => {
    const s = open();
    s.importStatement({ ...stmt([tx({ id: 'a', company: 'max' })]), company: 'max' }, 'סנכרון', 'sync');
    const data = parseBackup(JSON.stringify(makeBackup(s.exportData())));
    expect(data.imports[0].company).toBe('max');
    const restored = open();
    restored.restoreData(data);
    expect(restored.exportData().imports[0].company).toBe('max');
  });

  it('restores a backup from before imports recorded the company', () => {
    const s = open();
    s.importStatement(stmt([tx({ id: 'a' })]), 'f', 'excel');
    const { company: _company, ...oldImport } = s.exportData().imports[0];
    const data = parseBackup(JSON.stringify({ ...makeBackup(s.exportData()), imports: [oldImport] }));
    expect(data.imports[0].company).toBeNull();
    const restored = open();
    restored.restoreData(data);
    expect(restored.cards()[0].updatedAt).toBe(oldImport.at);
  });
});

describe('openDb on a database from before imports recorded the company', () => {
  it('adds the column and keeps the rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'paymate-'));
    const file = join(dir, 'old.db');
    const schemaDir = join(__dirname, '../electron/db');
    try {
      const old = new DatabaseSync(file);
      old.exec('CREATE TABLE imports (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, source TEXT NOT NULL, label TEXT NOT NULL, added INTEGER NOT NULL, skipped INTEGER NOT NULL)');
      old.exec("INSERT INTO imports (at, source, label, added, skipped) VALUES ('2030-09-01T00:00:00.000Z', 'excel', 'f', 1, 0)");
      old.close();

      const db = openDb(file, schemaDir);
      importStatement(db, { ...stmt([tx({ id: 'a', company: 'max' })]), company: 'max' }, 'f', 'sync');
      expect((db.prepare('SELECT COUNT(*) AS n FROM imports').get() as { n: number }).n).toBe(2);
      db.prepare('DELETE FROM imports WHERE company IS NOT NULL').run();
      // Only the old import is left, and it has no company, so it stands in.
      expect(listCards(db)[0].updatedAt).toBe('2030-09-01T00:00:00.000Z');
      db.close();

      // Opening again must not try to add the column twice.
      openDb(file, schemaDir).close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('insights with several cards', () => {
  let n = 0;
  const row = (over: Partial<TxRow>): TxRow => ({
    id: `m${++n}`, purchaseDate: '2026-10-01', chargeDate: '2026-10-02', merchant: 'חנות', categoryKey: 'other',
    chargedAmount: 100, originalAmount: 100, originalCurrency: 'ILS', standingOrder: false, foreignSite: false,
    discount: 0, company: 'isracard', cardLast4: '1234', ...over,
  });
  const MAX = { company: 'max', cardLast4: '1234' };
  const OTHER = { company: 'max', cardLast4: '5678' };
  const at = (mo: string, over: Partial<TxRow> = {}) =>
    row({ merchant: 'Netflix', chargedAmount: 50, chargeDate: `2026-${mo}-02`, purchaseDate: `2026-${mo}-01`, ...over });
  const filler = (mo: string, over: Partial<TxRow> = {}) => at(mo, { merchant: `קניה ${mo}`, ...over });
  const run = (all: TxRow[]) => buildInsights({ month: '2026-10', prevMonth: null, all, categoryNames: {} });

  it('keeps two companies with the same last four digits apart', () => {
    // Without the company, Max's October charges would count as covering October on the Isracard card, or the reverse.
    const gym = (mo: string) => at(mo, { ...MAX, merchant: 'Gym' });
    const all = [at('07'), at('08'), at('09'), filler('10'), gym('07'), gym('08'), gym('09'), gym('10')];
    expect(run(all).map((i) => i.id)).toContain('rec-missing-isracard:1234-Netflix');
    expect(recurringTimeline(all, 6).map((r) => r.card).sort()).toEqual(['isracard:1234', 'max:1234']);
  });

  it('does not call the same charge on two cards a duplicate', () => {
    expect(run([row({ merchant: 'קפה' }), row({ merchant: 'קפה', ...OTHER })]).some((i) => i.kind === 'duplicate')).toBe(false);
  });

  it('still finds a duplicate on one card', () => {
    expect(run([row({ merchant: 'קפה' }), row({ merchant: 'קפה' })]).filter((i) => i.kind === 'duplicate')).toHaveLength(1);
  });

  const moved = [at('07'), at('08'), at('09'), filler('10'), filler('07', OTHER), at('10', OTHER)];

  it('does not report a charge that moved to another card as missing', () => {
    expect(run(moved).some((i) => i.kind === 'missing')).toBe(false);
    expect(recurringTimeline(moved, 6).find((r) => r.card === 'isracard:1234')!.holes).toBe(0);
  });

  it('notices the move when viewing only the old card', () => {
    const items = insightsFor({ month: '2026-10', card: 'isracard:1234', all: moved, categoryNames: {} });
    expect(items.some((i) => i.kind === 'missing')).toBe(false);
    expect(recurringTimeline(moved, 6, 'isracard:1234')[0].holes).toBe(0);
  });

  it('still reports a missing charge when another card only has a different amount there', () => {
    const all = [at('07'), at('08'), at('09'), filler('10'), at('10', { ...OTHER, chargedAmount: 500 })];
    expect(run(all).map((i) => i.id)).toContain('rec-missing-isracard:1234-Netflix');
  });

  it('compares one card with the last month that card was charged, under ids of its own', () => {
    const all = [filler('08', { chargedAmount: 100 }), filler('09', { ...OTHER, chargedAmount: 900 }), filler('10', { chargedAmount: 300 })];
    const trend = insightsFor({ month: '2026-10', card: 'isracard:1234', all, categoryNames: {} }).find((i) => i.kind === 'trend')!;
    expect(trend.id).toBe('isracard:1234/trend-total');
    expect(trend.text).toContain('₪200');
    expect(trend.text).toContain('אוגוסט');
  });

  it('gives the combined view the insights of every card', () => {
    const all = [filler('09', { chargedAmount: 100 }), filler('10', { ...OTHER, chargedAmount: 300 })];
    expect(insightsFor({ month: '2026-10', all, categoryNames: {} })).toEqual(
      buildInsights({ month: '2026-10', prevMonth: '2026-09', all, categoryNames: {} }),
    );
  });
});

describe('card names', () => {
  it('names a card by its company, and keeps an unknown company as it is', () => {
    expect(cardLabel('max', '1234')).toBe('מקס 1234');
    expect(cardLabel('חברה אחרת', '1234')).toBe('חברה אחרת 1234');
  });

  it('groups cards by company', () => {
    const cards = [
      { key: 'max:1', company: 'max', last4: '1', updatedAt: 'x' },
      { key: 'max:2', company: 'max', last4: '2', updatedAt: 'x' },
      { key: 'amex:3', company: 'amex', last4: '3', updatedAt: null },
    ];
    expect(byCompany(cards)).toEqual([
      { company: 'max', cards: ['1', '2'], updatedAt: 'x' },
      { company: 'amex', cards: ['3'], updatedAt: null },
    ]);
  });
});
