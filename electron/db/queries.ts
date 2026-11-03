import type { Db } from './db';
import { insightsFor, monthOf, recurringTimeline } from '../../shared/core/insights';
import { listCards as cardsOf, totalsByCard } from '../../shared/core/cards';
import type {
  Budget, CardInfo, Category, FlagKind, FlaggedTx, InsightFlag, LastUpdate, MonthTotal, TimelineRow, UnknownMerchant, CategoryTotal, Insight, MerchantTotal, MonthSummary, TxRow,
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
  company: string;
  card_last4: string;
  flag_kind: FlagKind | null;
  flag_resolved: number | null;
  flag_comment: string | null;
}

const MONTH_SQL = 'COALESCE(substr(t.charge_date, 1, 7), substr(t.purchase_date, 1, 7))';
const CARD_SQL = "t.company || ':' || t.card_last4 = ?";

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
    company: r.company,
    cardLast4: r.card_last4,
    ...(r.flag_kind ? { flag: { kind: r.flag_kind, resolved: r.flag_resolved === 1, comment: r.flag_comment ?? '' } } : {}),
  };
}

const SELECT_TX = `SELECT t.id, t.purchase_date, t.charge_date, t.merchant, c.key AS category_key, t.charged_amount,
  t.original_amount, t.original_currency, t.standing_order, t.foreign_site, t.discount, t.company, t.card_last4,
  f.kind AS flag_kind, f.resolved AS flag_resolved, f.comment AS flag_comment
  FROM transactions t LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN tx_flags f ON f.tx_id = t.id`;

const INSIGHT_FLAG_COLUMNS = `key, month, insight_kind AS insightKind, text, comment, resolved, created_at AS createdAt, resolved_at AS resolvedAt`;

export function listInsightFlags(db: Db): InsightFlag[] {
  return (db.prepare(`SELECT ${INSIGHT_FLAG_COLUMNS} FROM insight_flags ORDER BY created_at DESC, key`).all() as unknown as Array<
    Omit<InsightFlag, 'resolved'> & { resolved: number }
  >).map((r) => ({ ...r, resolved: r.resolved === 1 }));
}

/** Every flag in all months, newest first. */
export function listFlags(db: Db): FlaggedTx[] {
  const rows = db
    .prepare(
      `SELECT f.tx_id, f.kind, f.comment, f.resolved, f.created_at, f.resolved_at, t.merchant, t.purchase_date,
              t.charged_amount, t.original_amount, t.original_currency
       FROM tx_flags f JOIN transactions t ON t.id = f.tx_id ORDER BY f.created_at DESC, f.tx_id`,
    )
    .all() as unknown as Array<{
    tx_id: string; kind: FlagKind; comment: string; resolved: number; created_at: string; resolved_at: string | null; merchant: string;
    purchase_date: string; charged_amount: number; original_amount: number; original_currency: string;
  }>;
  return rows.map((r) => ({
    txId: r.tx_id, kind: r.kind, comment: r.comment, resolved: r.resolved === 1, createdAt: r.created_at, resolvedAt: r.resolved_at,
    merchant: r.merchant, purchaseDate: r.purchase_date, chargedAmount: r.charged_amount, originalAmount: r.original_amount,
    originalCurrency: r.original_currency,
  }));
}

export function listMonths(db: Db, card?: string): string[] {
  const where = card ? `WHERE ${CARD_SQL}` : '';
  const rows = db.prepare(`SELECT DISTINCT ${MONTH_SQL} AS m FROM transactions t ${where} ORDER BY m DESC`).all(...(card ? [card] : [])) as Array<{ m: string }>;
  return rows.map((r) => r.m);
}

export function listCards(db: Db): CardInfo[] {
  const rows = db.prepare('SELECT DISTINCT company, card_last4 AS cardLast4 FROM transactions').all() as unknown as Array<{ company: string; cardLast4: string }>;
  const imports = db.prepare('SELECT at, company FROM imports').all() as unknown as Array<{ at: string; company: string | null }>;
  return cardsOf(rows, imports);
}

export function monthTotals(db: Db, card?: string): MonthTotal[] {
  const where = card ? `WHERE ${CARD_SQL}` : '';
  const rows = db
    .prepare(`SELECT ${MONTH_SQL} AS month, SUM(t.charged_amount) AS total FROM transactions t ${where} GROUP BY month ORDER BY month DESC LIMIT 12`)
    .all(...(card ? [card] : [])) as unknown as MonthTotal[];
  return rows.reverse();
}

export function recurringTimelineRows(db: Db, card?: string): TimelineRow[] {
  return recurringTimeline(allTransactions(db), 6, card);
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

export function monthTransactions(db: Db, month: string, card?: string): TxRow[] {
  const sql = `${SELECT_TX} WHERE ${MONTH_SQL} = ? ${card ? `AND ${CARD_SQL}` : ''} ORDER BY t.purchase_date DESC, t.id`;
  return (db.prepare(sql).all(month, ...(card ? [card] : [])) as unknown as Row[]).map(toTx);
}

export function monthSummary(db: Db, month: string, card?: string): MonthSummary {
  const cats = listCategories(db);
  const rows = monthTransactions(db, month, card);
  const months = listMonths(db, card);
  const prevMonth = months.filter((m) => m < month)[0] ?? null;
  const prevTotal = prevMonth
    ? monthTransactions(db, prevMonth, card).reduce((s, t) => s + t.chargedAmount, 0)
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
    byCard: totalsByCard(rows),
    byCategory: [...byCat.values()].sort((a, b) => b.amount - a.amount),
    topMerchants: [...byMerchant.values()].sort((a, b) => b.amount - a.amount).slice(0, 5),
  };
}

export function monthInsights(db: Db, month: string, card?: string): Insight[] {
  const cats = listCategories(db);
  return insightsFor({
    month,
    card,
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

export function getMonthlyTarget(db: Db): number | null {
  const row = db.prepare('SELECT amount FROM monthly_target WHERE id = 1').get() as { amount: number } | undefined;
  return row?.amount ?? null;
}

export function setMonthlyTarget(db: Db, amount: number | null) {
  if (amount == null || amount <= 0) {
    db.prepare('DELETE FROM monthly_target').run();
  } else {
    db.prepare('INSERT INTO monthly_target (id, amount) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET amount = excluded.amount').run(amount);
  }
}

export { monthOf };
