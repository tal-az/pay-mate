import { CATEGORY_SEEDS, categorize, makeCategory, type UserRule } from '../../shared/core/categorize';
import { buildInsights, monthOf, recurringTimeline } from '../../shared/core/insights';
import type { BackupData, BackupRule, BackupTransaction } from '../../shared/backup';
import { FLAG_KINDS, MAX_FLAG_COMMENT, insightFlagKey } from '../../shared/api';
import type {
  FlagKind, FlaggedTx, InsightFlag, TxFlag,
  Budget, Category, CategoryTotal, Insight, LastUpdate, MerchantTotal, MonthSummary, MonthTotal, TimelineRow, TxRow, UnknownMerchant,
} from '../../shared/api';
import type { ParsedStatement, Source } from '../../shared/types';

/**
 * The website's equivalent of electron/db/db.ts and queries.ts: the same operations with the same results, on the
 * plain document that is also the backup format. Mutating functions change `data` in place; the caller decides
 * whether the change is kept (see idb.ts, which writes it back in one transaction or not at all).
 */

/** The built-in categories followed by the ones the user made. */
export function categoriesOf(data: BackupData): Category[] {
  return [...CATEGORY_SEEDS, ...data.categories].map((c, i) => ({ id: i + 1, key: c.key, name: c.name, color: c.color }));
}

export function addCategory(data: BackupData, name: string, color: string): Category {
  const c = makeCategory(name, color, categoriesOf(data));
  data.categories.push(c);
  return { id: CATEGORY_SEEDS.length + data.categories.length, ...c };
}

function requireCategory(data: BackupData, key: string) {
  if (!categoriesOf(data).some((c) => c.key === key)) throw new Error(`unknown category ${key}`);
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
  requireCategory(data, categoryKey);
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
  requireCategory(data, categoryKey);
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

/** Flags a transaction, or edits its flag; an edited flag stays resolved or open as it was. */
export function setFlag(data: BackupData, txId: string, kind: FlagKind, comment: string) {
  if (!FLAG_KINDS.includes(kind)) throw new Error(`unknown flag kind ${kind}`);
  const text = comment.trim();
  if (text.length > MAX_FLAG_COMMENT) throw new Error(`ההערה ארוכה מדי (עד ${MAX_FLAG_COMMENT} תווים)`);
  if (!data.transactions.some((t) => t.id === txId)) throw new Error('transaction not found');
  const existing = data.flags.find((f) => f.txId === txId);
  if (existing) {
    existing.kind = kind;
    existing.comment = text;
  } else {
    data.flags.push({ txId, kind, comment: text, resolved: false, createdAt: new Date().toISOString(), resolvedAt: null });
  }
}

export function resolveFlag(data: BackupData, txId: string, resolved: boolean) {
  const f = data.flags.find((x) => x.txId === txId);
  if (!f) return;
  f.resolved = resolved;
  f.resolvedAt = resolved ? new Date().toISOString() : null;
}

export function clearFlag(data: BackupData, txId: string) {
  data.flags = data.flags.filter((f) => f.txId !== txId);
}

/** Adds an insight to the follow-up list, or edits its comment; an edited flag stays resolved or open as it was. */
export function setInsightFlag(data: BackupData, month: string, insight: { id: string; kind: string; text: string }, comment: string) {
  const note = comment.trim();
  if (note.length > MAX_FLAG_COMMENT) throw new Error(`ההערה ארוכה מדי (עד ${MAX_FLAG_COMMENT} תווים)`);
  const key = insightFlagKey(month, insight.id);
  const existing = data.insightFlags.find((f) => f.key === key);
  if (existing) existing.comment = note;
  else {
    data.insightFlags.push({
      key, month, insightKind: insight.kind, text: insight.text, comment: note, resolved: false, createdAt: new Date().toISOString(), resolvedAt: null,
    });
  }
}

export function resolveInsightFlag(data: BackupData, key: string, resolved: boolean) {
  const f = data.insightFlags.find((x) => x.key === key);
  if (!f) return;
  f.resolved = resolved;
  f.resolvedAt = resolved ? new Date().toISOString() : null;
}

export function clearInsightFlag(data: BackupData, key: string) {
  data.insightFlags = data.insightFlags.filter((f) => f.key !== key);
}

export function listInsightFlags(data: BackupData): InsightFlag[] {
  return data.insightFlags.map((f) => ({ ...f })).sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.key < b.key ? -1 : 1));
}

export function setBudget(data: BackupData, categoryKey: string, monthlyAmount: number | null) {
  requireCategory(data, categoryKey);
  data.budgets = data.budgets.filter((b) => b.categoryKey !== categoryKey);
  if (monthlyAmount != null && monthlyAmount > 0) data.budgets.push({ categoryKey, monthlyAmount });
}

// ---- Queries ----

function toTx(t: BackupTransaction, flags: Map<string, TxFlag>): TxRow {
  const f = flags.get(t.id);
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
    ...(f ? { flag: { kind: f.kind, resolved: f.resolved, comment: f.comment } } : {}),
  };
}

/** Every flag in all months, newest first. */
export function listFlags(data: BackupData): FlaggedTx[] {
  const txs = new Map(data.transactions.map((t) => [t.id, t]));
  const out: FlaggedTx[] = [];
  for (const f of data.flags) {
    const t = txs.get(f.txId);
    if (t) out.push({ ...f, merchant: t.merchant, purchaseDate: t.purchaseDate, chargedAmount: t.chargedAmount, originalAmount: t.originalAmount, originalCurrency: t.originalCurrency });
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.txId < b.txId ? -1 : 1));
}

/** Newest purchase first; the id breaks ties so the order is stable. */
const newestFirst = (a: TxRow, b: TxRow) =>
  a.purchaseDate < b.purchaseDate ? 1 : a.purchaseDate > b.purchaseDate ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export function allTransactions(data: BackupData): TxRow[] {
  const flags = new Map(data.flags.map((f) => [f.txId, f]));
  return data.transactions.map((t) => toTx(t, flags)).sort(newestFirst);
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

  const categories = categoriesOf(data);
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
    categoryNames: Object.fromEntries(categoriesOf(data).map((c) => [c.key, c.name])),
  });
}

export function listBudgets(data: BackupData): Budget[] {
  return data.budgets.map((b) => ({ categoryKey: b.categoryKey, monthlyAmount: b.monthlyAmount }));
}
