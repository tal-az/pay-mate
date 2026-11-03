import { CATEGORY_SEEDS, categorize, type UserRule } from '../../shared/core/categorize';
import { buildInsights, monthOf, recurringTimeline } from '../../shared/core/insights';
import type { BackupData, BackupRule, BackupTransaction } from '../../shared/backup';
import type {
  Budget, Category, CategoryTotal, Insight, LastUpdate, MerchantTotal, MonthSummary, MonthTotal, TimelineRow, TxRow, UnknownMerchant,
} from '../../shared/api';
import type { ParsedStatement, Source } from '../../shared/types';

/**
 * The website's equivalent of electron/db/db.ts and queries.ts: the same operations with the same results, on the
 * plain document that is also the backup format. Mutating functions change `data` in place; the caller decides
 * whether the change is kept (see idb.ts, which writes it back in one transaction or not at all).
 */

const KEYS = new Set(CATEGORY_SEEDS.map((c) => c.key));

export const categories: Category[] = CATEGORY_SEEDS.map((c, i) => ({ id: i + 1, key: c.key, name: c.name, color: c.color }));

function requireCategory(key: string) {
  if (!KEYS.has(key)) throw new Error(`unknown category ${key}`);
}

const byLengthDesc = (a: BackupRule, b: BackupRule) => b.pattern.length - a.pattern.length;
const userRules = (data: BackupData): UserRule[] =>
  data.rules.filter((r) => r.origin === 'user').sort(byLengthDesc).map((r) => ({ pattern: r.pattern, categoryKey: r.categoryKey }));

/** Adds the rule, or re-points an existing rule for the same pattern at the new category. */
function upsertRule(data: BackupData, pattern: string, categoryKey: string) {
  const existing = data.rules.find((r) => r.pattern === pattern);
  if (existing) existing.categoryKey = categoryKey;
  else data.rules.push({ pattern, categoryKey, origin: 'user' });
}

/** Inserts new transactions; ones already present (same id) are skipped, so re-imports are safe. */
export function importStatement(data: BackupData, stmt: ParsedStatement, label: string, source: Source) {
  const rules = userRules(data);
  const ids = new Set(data.transactions.map((t) => t.id));
  let added = 0;
  let skipped = 0;
  for (const t of stmt.transactions) {
    if (ids.has(t.id)) {
      skipped++;
      continue;
    }
    ids.add(t.id);
    data.transactions.push({
      id: t.id, company: t.company, cardLast4: t.cardLast4, purchaseDate: t.purchaseDate, chargeDate: t.chargeDate,
      rawMerchant: t.rawMerchant, merchant: t.merchant, originalAmount: t.originalAmount, originalCurrency: t.originalCurrency,
      chargedAmount: t.chargedAmount, chargedCurrency: t.chargedCurrency, voucher: t.voucher, standingOrder: t.standingOrder,
      foreignSite: t.foreignSite, discount: t.discount, details: t.details, categoryKey: categorize(t, rules),
      categoryLocked: false, source,
    });
    added++;
  }
  data.imports.push({ at: new Date().toISOString(), source, label, added, skipped });
  return { added, skipped };
}

/** Sets a category by hand and, optionally, remembers it for every transaction from that business. */
export function setCategory(data: BackupData, txId: string, categoryKey: string, applyToMerchant: boolean) {
  requireCategory(categoryKey);
  const tx = data.transactions.find((t) => t.id === txId);
  if (!tx) throw new Error('transaction not found');
  if (applyToMerchant) {
    upsertRule(data, tx.merchant.toLowerCase(), categoryKey);
    for (const t of data.transactions) if (t.merchant === tx.merchant && !t.categoryLocked) t.categoryKey = categoryKey;
  }
  tx.categoryKey = categoryKey;
  tx.categoryLocked = true;
}

/** Maps every charge from this business, in all months, to a category, and remembers it for future imports. Returns how many charges changed. */
export function assignMerchant(data: BackupData, merchant: string, categoryKey: string): number {
  requireCategory(categoryKey);
  upsertRule(data, merchant.toLowerCase(), categoryKey);
  data.reviews = data.reviews.filter((r) => r.merchantKey !== merchant);
  let changed = 0;
  for (const t of data.transactions) {
    if (t.merchant === merchant && !t.categoryLocked) {
      t.categoryKey = categoryKey;
      changed++;
    }
  }
  return changed;
}

/** The user looked at this business and chose to leave it as "other", so it is not asked about again. */
export function keepMerchantAsOther(data: BackupData, merchant: string) {
  data.reviews = data.reviews.filter((r) => r.merchantKey !== merchant);
  data.reviews.push({ merchantKey: merchant, decidedAt: new Date().toISOString() });
}

/** Reverses assignMerchant or keepMerchantAsOther: the business goes back to being unknown. */
export function undoMerchant(data: BackupData, merchant: string) {
  const pattern = merchant.toLowerCase();
  data.rules = data.rules.filter((r) => !(r.pattern === pattern && r.origin === 'user'));
  data.reviews = data.reviews.filter((r) => r.merchantKey !== merchant);
  for (const t of data.transactions) if (t.merchant === merchant && !t.categoryLocked) t.categoryKey = 'other';
}

export function setBudget(data: BackupData, categoryKey: string, monthlyAmount: number | null) {
  requireCategory(categoryKey);
  data.budgets = data.budgets.filter((b) => b.categoryKey !== categoryKey);
  if (monthlyAmount != null && monthlyAmount > 0) data.budgets.push({ categoryKey, monthlyAmount });
}

// ---- Queries ----

function toTx(t: BackupTransaction): TxRow {
  return {
    id: t.id,
    purchaseDate: t.purchaseDate,
    chargeDate: t.chargeDate,
    merchant: t.merchant,
    categoryKey: t.categoryKey,
    chargedAmount: t.chargedAmount,
    originalAmount: t.originalAmount,
    originalCurrency: t.originalCurrency,
    standingOrder: t.standingOrder,
    foreignSite: t.foreignSite,
    discount: t.discount,
    cardLast4: t.cardLast4,
  };
}

/** Newest purchase first; the id breaks ties so the order is stable. */
const newestFirst = (a: TxRow, b: TxRow) =>
  a.purchaseDate < b.purchaseDate ? 1 : a.purchaseDate > b.purchaseDate ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export function allTransactions(data: BackupData): TxRow[] {
  return data.transactions.map(toTx).sort(newestFirst);
}

export function monthTransactions(data: BackupData, month: string): TxRow[] {
  return allTransactions(data).filter((t) => monthOf(t) === month);
}

export function listMonths(data: BackupData): string[] {
  return [...new Set(data.transactions.map(monthOf))].sort().reverse();
}

export function monthTotals(data: BackupData): MonthTotal[] {
  const totals = new Map<string, number>();
  for (const t of data.transactions) totals.set(monthOf(t), (totals.get(monthOf(t)) ?? 0) + t.chargedAmount);
  return [...totals.entries()]
    .map(([month, total]) => ({ month, total }))
    .sort((a, b) => (a.month < b.month ? 1 : -1))
    .slice(0, 12)
    .reverse();
}

export function recurringTimelineRows(data: BackupData): TimelineRow[] {
  return recurringTimeline(allTransactions(data), 6);
}

/** Businesses in a month that landed in "other" automatically and that the user has not decided about yet. */
export function unknownMerchants(data: BackupData, month: string): UnknownMerchant[] {
  const reviewed = new Set(data.reviews.map((r) => r.merchantKey));
  const found = new Map<string, UnknownMerchant>();
  for (const t of data.transactions) {
    if (t.categoryKey !== 'other' || t.categoryLocked || monthOf(t) !== month || reviewed.has(t.merchant)) continue;
    const e = found.get(t.merchant) ?? { merchant: t.merchant, count: 0, total: 0, firstDate: t.purchaseDate, lastDate: t.purchaseDate };
    e.count += 1;
    e.total += t.chargedAmount;
    if (t.purchaseDate < e.firstDate) e.firstDate = t.purchaseDate;
    if (t.purchaseDate > e.lastDate) e.lastDate = t.purchaseDate;
    found.set(t.merchant, e);
  }
  return [...found.values()].sort((a, b) => b.total - a.total);
}

export function lastUpdate(data: BackupData): LastUpdate | null {
  let last: LastUpdate | null = null;
  for (const i of data.imports) if (!last || i.at >= last.at) last = { at: i.at, source: i.source };
  return last;
}

export function monthSummary(data: BackupData, month: string): MonthSummary {
  const rows = monthTransactions(data, month);
  const prevMonth = listMonths(data).filter((m) => m < month)[0] ?? null;
  const prevTotal = prevMonth ? monthTransactions(data, prevMonth).reduce((s, t) => s + t.chargedAmount, 0) : null;

  const byCat = new Map<string, CategoryTotal>();
  const byMerchant = new Map<string, MerchantTotal>();
  for (const t of rows) {
    const c = categories.find((x) => x.key === t.categoryKey) ?? categories.find((x) => x.key === 'other')!;
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

export function monthInsights(data: BackupData, month: string): Insight[] {
  return buildInsights({
    month,
    prevMonth: listMonths(data).filter((m) => m < month)[0] ?? null,
    all: allTransactions(data),
    categoryNames: Object.fromEntries(categories.map((c) => [c.key, c.name])),
  });
}

export function listBudgets(data: BackupData): Budget[] {
  return data.budgets.map((b) => ({ categoryKey: b.categoryKey, monthlyAmount: b.monthlyAmount }));
}
