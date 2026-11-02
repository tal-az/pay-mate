import type { Db } from './db';
import { buildInsights, monthOf, recurringTimeline } from '../core/insights';
import type {
  Budget, Category, LastUpdate, MonthTotal, TimelineRow, UnknownMerchant, CategoryTotal, Insight, MerchantTotal, MonthSummary, TxRow,
} from '../../shared/api';

interface Row {
  id: string;
  purchase_date: string;
  charge_date: string | null;
  merchant: string;
  category_key: string | null;
  charged_amount: number;
  original_amount: number;
  original_currency: string;
  standing_order: number;
  foreign_site: number;
  discount: number;
  card_last4: string;
}

const MONTH_SQL = 'COALESCE(substr(t.charge_date, 1, 7), substr(t.purchase_date, 1, 7))';

function toTx(r: Row): TxRow {
  return {
    id: r.id,
    purchaseDate: r.purchase_date,
    chargeDate: r.charge_date,
    merchant: r.merchant,
    categoryKey: r.category_key ?? 'other',
    chargedAmount: r.charged_amount,
    originalAmount: r.original_amount,
    originalCurrency: r.original_currency,
    standingOrder: r.standing_order === 1,
    foreignSite: r.foreign_site === 1,
    discount: r.discount,
    cardLast4: r.card_last4,
  };
}

const SELECT_TX = `SELECT t.id, t.purchase_date, t.charge_date, t.merchant, c.key AS category_key, t.charged_amount,
  t.original_amount, t.original_currency, t.standing_order, t.foreign_site, t.discount, t.card_last4
  FROM transactions t LEFT JOIN categories c ON c.id = t.category_id`;

export function listMonths(db: Db): string[] {
  const rows = db.prepare(`SELECT DISTINCT ${MONTH_SQL} AS m FROM transactions t ORDER BY m DESC`).all() as Array<{ m: string }>;
  return rows.map((r) => r.m);
}

export function monthTotals(db: Db): MonthTotal[] {
  const rows = db
    .prepare(`SELECT ${MONTH_SQL} AS month, SUM(t.charged_amount) AS total FROM transactions t GROUP BY month ORDER BY month DESC LIMIT 12`)
    .all() as unknown as MonthTotal[];
  return rows.reverse();
}

export function recurringTimelineRows(db: Db): TimelineRow[] {
  return recurringTimeline(allTransactions(db), 6);
}

/** Businesses in a month that landed in "other" automatically and that the user has not decided about yet. */
export function unknownMerchants(db: Db, month: string): UnknownMerchant[] {
  return db
    .prepare(
      `SELECT t.merchant AS merchant, COUNT(*) AS count, SUM(t.charged_amount) AS total,
              MIN(t.purchase_date) AS firstDate, MAX(t.purchase_date) AS lastDate
       FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE c.key = 'other' AND t.category_locked = 0 AND ${MONTH_SQL} = ?
         AND t.merchant NOT IN (SELECT merchant_key FROM merchant_reviews)
       GROUP BY t.merchant ORDER BY total DESC`,
    )
    .all(month) as unknown as UnknownMerchant[];
}

export function lastUpdate(db: Db): LastUpdate | null {
  const row = db.prepare('SELECT at, source FROM imports ORDER BY at DESC, id DESC LIMIT 1').get() as unknown as LastUpdate | undefined;
  return row ?? null;
}

export function listCategories(db: Db): Category[] {
  return db.prepare('SELECT id, key, name, color FROM categories ORDER BY id').all() as unknown as Category[];
}

export function allTransactions(db: Db): TxRow[] {
  return (db.prepare(`${SELECT_TX} ORDER BY t.purchase_date DESC, t.id`).all() as unknown as Row[]).map(toTx);
}

export function monthTransactions(db: Db, month: string): TxRow[] {
  return (db.prepare(`${SELECT_TX} WHERE ${MONTH_SQL} = ? ORDER BY t.purchase_date DESC, t.id`).all(month) as unknown as Row[]).map(toTx);
}

export function monthSummary(db: Db, month: string): MonthSummary {
  const cats = listCategories(db);
  const rows = monthTransactions(db, month);
  const months = listMonths(db);
  const prevMonth = months.filter((m) => m < month)[0] ?? null;
  const prevTotal = prevMonth
    ? monthTransactions(db, prevMonth).reduce((s, t) => s + t.chargedAmount, 0)
    : null;

  const byCat = new Map<string, CategoryTotal>();
  const byMerchant = new Map<string, MerchantTotal>();
  for (const t of rows) {
    const c = cats.find((x) => x.key === t.categoryKey) ?? cats.find((x) => x.key === 'other')!;
    const e = byCat.get(c.key) ?? { key: c.key, name: c.name, color: c.color, amount: 0, count: 0 };
    e.amount += t.chargedAmount;
    e.count += 1;
    byCat.set(c.key, e);
    const m = byMerchant.get(t.merchant) ?? { merchant: t.merchant, amount: 0, count: 0 };
    m.amount += t.chargedAmount;
    m.count += 1;
    byMerchant.set(t.merchant, m);
  }
  return {
    month,
    total: rows.reduce((s, t) => s + t.chargedAmount, 0),
    prevMonth,
    prevTotal,
    transactionCount: rows.length,
    cards: [...new Set(rows.map((t) => t.cardLast4))],
    byCategory: [...byCat.values()].sort((a, b) => b.amount - a.amount),
    topMerchants: [...byMerchant.values()].sort((a, b) => b.amount - a.amount).slice(0, 5),
  };
}

export function monthInsights(db: Db, month: string): Insight[] {
  const cats = listCategories(db);
  const months = listMonths(db);
  return buildInsights({
    month,
    prevMonth: months.filter((m) => m < month)[0] ?? null,
    all: allTransactions(db),
    categoryNames: Object.fromEntries(cats.map((c) => [c.key, c.name])),
  });
}

export function listBudgets(db: Db): Budget[] {
  return db
    .prepare('SELECT c.key AS categoryKey, b.monthly_amount AS monthlyAmount FROM budgets b JOIN categories c ON c.id = b.category_id')
    .all() as unknown as Budget[];
}

export function setBudget(db: Db, categoryKey: string, monthlyAmount: number | null) {
  const cat = db.prepare('SELECT id FROM categories WHERE key = ?').get(categoryKey) as { id: number } | undefined;
  if (!cat) throw new Error(`unknown category ${categoryKey}`);
  if (monthlyAmount == null || monthlyAmount <= 0) {
    db.prepare('DELETE FROM budgets WHERE category_id = ?').run(cat.id);
  } else {
    db.prepare(
      'INSERT INTO budgets (category_id, monthly_amount) VALUES (?, ?) ON CONFLICT(category_id) DO UPDATE SET monthly_amount = excluded.monthly_amount',
    ).run(cat.id, monthlyAmount);
  }
}

export { monthOf };
