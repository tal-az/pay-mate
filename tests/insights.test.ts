import { describe, expect, it } from 'vitest';
import { buildInsights, recurringTimeline } from '../shared/core/insights';
import type { TxRow } from '../shared/api';

let n = 0;
const tx = (over: Partial<TxRow>): TxRow => ({
  id: `t${++n}`, purchaseDate: '2026-10-01', chargeDate: '2026-10-02', merchant: 'חנות', categoryKey: 'other',
  chargedAmount: 100, originalAmount: 100, originalCurrency: 'ILS', standingOrder: false, foreignSite: false,
  discount: 0, cardLast4: '1234', ...over,
});
const names = { groceries: 'מזון ומכולת', other: 'אחר' };
const run = (all: TxRow[], month = '2026-10', prevMonth: string | null = '2026-09') =>
  buildInsights({ month, prevMonth, all, categoryNames: names });

describe('buildInsights', () => {
  it('reports the change against the previous month', () => {
    const all = [
      tx({ chargedAmount: 1000, chargeDate: '2026-09-02', purchaseDate: '2026-08-20', merchant: 'א' }),
      tx({ chargedAmount: 1500, merchant: 'ב' }),
    ];
    const t = run(all).find((i) => i.id === 'trend-total')!;
    expect(t.text).toContain('יותר');
    expect(t.attention).toBe(true);
  });

  it('flags a category that grew a lot', () => {
    const all = [
      tx({ categoryKey: 'groceries', chargedAmount: 300, chargeDate: '2026-09-02', merchant: 'א' }),
      tx({ categoryKey: 'groceries', chargedAmount: 700, merchant: 'ב' }),
    ];
    expect(run(all).some((i) => i.id === 'trend-cat-groceries')).toBe(true);
  });

  it('detects a steady recurring charge across three months', () => {
    const m = (mo: string) => tx({ merchant: 'Netflix', chargedAmount: 50, chargeDate: `2026-${mo}-02`, purchaseDate: `2026-${mo}-01` });
    const found = run([m('08'), m('09'), m('10')]).find((i) => i.id === 'sub-Netflix');
    expect(found?.text).toContain('חיוב חוזר');
  });

  it('flags a new standing order seen for the first time', () => {
    const all = [
      tx({ merchant: 'ישן', chargeDate: '2026-09-02' }),
      tx({ merchant: 'חדש', standingOrder: true, chargedAmount: 12 }),
    ];
    expect(run(all).some((i) => i.id === 'sub-new-חדש')).toBe(true);
  });

  it('flags a charge far above the merchant usual amount', () => {
    const past = ['07', '08', '09'].map((mo) => tx({ merchant: 'סופר', chargedAmount: 100, chargeDate: `2026-${mo}-02`, purchaseDate: `2026-${mo}-01` }));
    const all = [...past, tx({ merchant: 'סופר', chargedAmount: 900 })];
    expect(run(all).some((i) => i.kind === 'unusual')).toBe(true);
  });

  it('flags possible duplicate charges within a day', () => {
    const all = [
      tx({ id: 'a', merchant: 'קפה', chargedAmount: 30, purchaseDate: '2026-10-01' }),
      tx({ id: 'b', merchant: 'קפה', chargedAmount: 30, purchaseDate: '2026-10-01' }),
    ];
    expect(run(all, '2026-10', null).filter((i) => i.kind === 'duplicate')).toHaveLength(1);
  });

  it('returns nothing for a month without data', () => {
    expect(run([], '2026-10')).toEqual([]);
  });
});

describe('recurring charge insights', () => {
  const rec = (merchant: string, mo: string, amount = 50, over: Partial<TxRow> = {}) =>
    tx({ merchant, chargedAmount: amount, chargeDate: `2026-${mo}-02`, purchaseDate: `2026-${mo}-01`, ...over });
  const other = (mo: string) => tx({ merchant: `קניה ${mo}`, chargeDate: `2026-${mo}-02`, purchaseDate: `2026-${mo}-01` });
  const ids = (all: TxRow[], month: string) => run(all, month, null).map((i) => i.id);

  it('flags a monthly charge that is missing this month', () => {
    const all = [rec('Netflix', '07'), rec('Netflix', '08'), rec('Netflix', '09'), other('10')];
    const missing = run(all, '2026-10').find((i) => i.id === 'rec-missing-1234-Netflix')!;
    expect(missing.attention).toBe(true);
    expect(missing.text).toContain('לא חויב');
  });

  it('says a charge seems to have stopped after two missing months', () => {
    const all = [rec('Netflix', '06'), rec('Netflix', '07'), rec('Netflix', '08'), other('09'), other('10')];
    const stopped = run(all, '2026-10').find((i) => i.id === 'rec-stopped-1234-Netflix')!;
    expect(stopped.attention).toBe(false);
    expect(stopped.text).toContain('2 חודשים');
  });

  it('does not call it a hole when the card has no statement for that month', () => {
    const all = [rec('Netflix', '07'), rec('Netflix', '08'), rec('Netflix', '09'), other('10')];
    // The October charges belong to another card, so card 1234 has nothing in October at all.
    const moved = all.map((t) => (t.chargeDate?.startsWith('2026-10') ? { ...t, cardLast4: '9999' } : t));
    expect(ids(moved, '2026-10').some((i) => i.startsWith('rec-missing'))).toBe(false);
  });

  it('needs three months of history before calling anything missing', () => {
    const all = [rec('Netflix', '08'), rec('Netflix', '09'), other('10')];
    expect(ids(all, '2026-10').some((i) => i.startsWith('rec-missing'))).toBe(false);
  });

  it('reports a price change on a recurring charge', () => {
    const all = [rec('Spotify', '08', 20), rec('Spotify', '09', 20), rec('Spotify', '10', 23)];
    const price = run(all, '2026-10').find((i) => i.id === 'rec-price-1234-Spotify')!;
    expect(price.text).toContain('עלה');
    expect(price.attention).toBe(true);
  });

  it('flags a recurring charge billed twice in one month', () => {
    const all = [rec('Gym', '08', 100), rec('Gym', '09', 100), rec('Gym', '10', 100, { id: 'g1' }), rec('Gym', '10', 100, { id: 'g2' })];
    expect(ids(all, '2026-10')).toContain('rec-double-1234-Gym');
  });

  it('summarizes the monthly commitments', () => {
    const m = (name: string, amount: number) => ['08', '09', '10'].map((mo) => rec(name, mo, amount));
    const found = run([...m('א', 40), ...m('ב', 60)], '2026-10').find((i) => i.id === 'rec-commitments')!;
    expect(found.text).toContain('2 חיובים קבועים');
    expect(found.text).toContain('100');
  });

  it('ignores groceries-style charges whose amounts vary a lot', () => {
    const all = [rec('סופר', '08', 60), rec('סופר', '09', 300), rec('סופר', '10', 150)];
    expect(ids(all, '2026-10').some((i) => i.startsWith('rec-'))).toBe(false);
  });
});

describe('recurringTimeline', () => {
  const rec = (merchant: string, mo: string) =>
    tx({ merchant, chargedAmount: 50, chargeDate: `2026-${mo}-02`, purchaseDate: `2026-${mo}-01` });
  const filler = (mo: string) => tx({ merchant: `קניה ${mo}`, chargeDate: `2026-${mo}-02`, purchaseDate: `2026-${mo}-01` });

  it('marks a covered month without the charge as a hole, and orders rows with holes first', () => {
    const all = [
      rec('Netflix', '07'), rec('Netflix', '09'), rec('Netflix', '10'), filler('08'),
      rec('Gym', '07'), rec('Gym', '08'), rec('Gym', '09'), rec('Gym', '10'),
    ];
    const rows = recurringTimeline(all, 6);
    expect(rows.map((r) => r.merchant)).toEqual(['Netflix', 'Gym']);
    expect(rows[0].holes).toBe(1);
    expect(rows[0].cells.map((c) => c.amount != null)).toEqual([true, false, true, true]);
    expect(rows[1].holes).toBe(0);
  });

  it('does not count months before the first charge as holes', () => {
    const all = [filler('06'), rec('Netflix', '07'), rec('Netflix', '08'), rec('Netflix', '09')];
    expect(recurringTimeline(all, 6)[0].holes).toBe(0);
  });
});
