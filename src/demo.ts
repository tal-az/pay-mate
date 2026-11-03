import { insightsFor, monthOf, recurringTimeline } from '../shared/core/insights';
import { filterByCard, listCards, totalsByCard } from '../shared/core/cards';
import { CATEGORY_SEEDS, makeCategory } from '../shared/core/categorize';
import { emptyData, makeBackup } from '../shared/backup';
import { MAX_FLAG_COMMENT, insightFlagKey } from '../shared/api';
import type {
  Budget, Category, FlaggedTx, ImportResult, InsightFlag, MonthSummary, PayMateApi, TxRow,
} from '../shared/api';

/** Synthetic data so the interface can be developed and previewed in a plain browser (open the site with ?demo). */
const categories: Category[] = CATEGORY_SEEDS.map((c, i) => ({ id: i + 1, key: c.key, name: c.name, color: c.color }));

let n = 0;
function tx(month: string, day: string, merchant: string, key: string, amount: number, extra: Partial<TxRow> = {}): TxRow {
  const [y, m] = month.split('-').map(Number);
  const purchaseMonth = day === '28' || day === '29' || day === '25' ? (m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`) : month;
  return {
    id: `demo-${++n}`, purchaseDate: `${purchaseMonth}-${day}`, chargeDate: `${month}-02`, merchant, categoryKey: key,
    chargedAmount: amount, originalAmount: amount, originalCurrency: 'ILS', standingOrder: false, foreignSite: false,
    discount: 0, company: 'isracard', cardLast4: '1958', ...extra,
  };
}

const ON_MAX = { company: 'max', cardLast4: '4821' };

function monthRows(month: string, scale: number): TxRow[] {
  const r = (x: number) => Math.round(x * scale * 100) / 100;
  return [
    tx(month, '28', 'סופר השכונה', 'groceries', r(187.79)),
    tx(month, '20', 'סופר השכונה', 'groceries', r(140.25)),
    tx(month, '12', 'שוק האיכרים', 'groceries', r(96)),
    tx(month, '25', 'מכולת הפינה', 'groceries', r(52.5)),
    tx(month, '27', 'קפה ליד הבית', 'restaurants', r(42)),
    tx(month, '15', 'פלאפל הכיכר', 'restaurants', r(49)),
    tx(month, '08', 'מסעדת הים', 'restaurants', r(238)),
    tx(month, '25', 'תחנת דלק', 'transport', r(210)),
    tx(month, '09', 'חניון העיר', 'transport', r(40)),
    tx(month, '22', 'Google One', 'subscriptions', 74.9, { standingOrder: true, foreignSite: true }),
    tx(month, '29', 'APPLE.COM/BILL', 'subscriptions', 11.9, { standingOrder: true, foreignSite: true }),
    tx(month, '23', 'ביטוח רכב', 'bills', 124.45, { standingOrder: true, discount: 6.55 }),
    tx(month, '22', 'בית מרקחת', 'health', r(74.9)),
    tx(month, '14', 'AWS EMEA', 'subscriptions', 2.06, { foreignSite: true, originalAmount: 0.67, originalCurrency: 'USD' }),
    tx(month, '18', 'סופר השכונה', 'groceries', r(164.3), ON_MAX),
    tx(month, '10', 'סטודיו יוגה', 'health', 220, { ...ON_MAX, standingOrder: true }),
    tx(month, '06', 'קפה ליד הבית', 'restaurants', r(36), ON_MAX),
  ];
}

const allData: TxRow[] = [
  ...monthRows('2026-08', 0.85),
  ...monthRows('2026-09', 0.95),
  ...monthRows('2026-10', 1.12),
  tx('2026-10', '30', 'ריהוט הבית', 'other', 1290),
  tx('2026-10', '03', 'קפה ליד הבית', 'restaurants', 42),
  tx('2026-10', '11', 'חומוס נרי', 'other', 278),
  tx('2026-10', '17', 'גאזטה בר - יין בע"מ', 'other', 155),
  tx('2026-10', '19', 'טאקריה', 'other', 94),
  tx('2026-10', '21', 'טאקריה', 'other', 61),
  tx('2026-10', '24', 'ויטרינה', 'other', 72),
  tx('2026-10', '26', 'HARIM בייקרי', 'other', 158),
  tx('2026-10', '03', 'קפה ליד הבית', 'restaurants', 42),
];

/** One recurring charge is missing in September, so the demo shows a hole. */
const data = allData.filter((t) => !(t.merchant === 'APPLE.COM/BILL' && t.chargeDate?.startsWith('2026-09')));

const reviewed = new Set<string>();
const insightFlags = new Map<string, InsightFlag>();
const flagMeta = new Map<string, { createdAt: string; resolvedAt: string | null }>();

const budgets: Budget[] = [{ categoryKey: 'groceries', monthlyAmount: 700 }, { categoryKey: 'restaurants', monthlyAmount: 300 }];
let monthlyTarget: number | null = null;

const sleep = () => new Promise((r) => setTimeout(r, 20));
const monthsDesc = (card?: string) => [...new Set(filterByCard(data, card).map(monthOf))].sort().reverse();
const rowsOf = (month: string, card?: string) => filterByCard(data, card).filter((t) => monthOf(t) === month).sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate));
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

export const demoApi: PayMateApi = {
  async months() { await sleep(); return monthsDesc(); },
  async cards() { return listCards(data, [{ at: hoursAgo(72), company: 'isracard' }, { at: hoursAgo(8), company: 'max' }]); },
  async monthTotals(card) {
    return monthsDesc(card).slice().reverse().map((m) => ({ month: m, total: rowsOf(m, card).reduce((s, t) => s + t.chargedAmount, 0) }));
  },
  async recurringTimeline(card) { return recurringTimeline(data, 6, card); },
  async unknownMerchants(month) {
    await sleep();
    const m = new Map<string, { merchant: string; count: number; total: number; firstDate: string; lastDate: string }>();
    for (const t of rowsOf(month)) {
      if (t.categoryKey !== 'other' || reviewed.has(t.merchant)) continue;
      const e = m.get(t.merchant) ?? { merchant: t.merchant, count: 0, total: 0, firstDate: t.purchaseDate, lastDate: t.purchaseDate };
      e.count++; e.total += t.chargedAmount;
      if (t.purchaseDate < e.firstDate) e.firstDate = t.purchaseDate;
      if (t.purchaseDate > e.lastDate) e.lastDate = t.purchaseDate;
      m.set(t.merchant, e);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  },
  async mapMerchant(merchant, key) {
    if (key === 'other') { reviewed.add(merchant); return; }
    for (const t of data) if (t.merchant === merchant) t.categoryKey = key;
  },
  async undoMapMerchant(merchant) {
    reviewed.delete(merchant);
    for (const t of data) if (t.merchant === merchant) t.categoryKey = 'other';
  },
  async lastUpdate() { return { at: new Date(Date.now() - 3 * 86_400_000).toISOString(), source: 'sync' as const }; },
  async categories() { return [...categories]; },
  async addCategory(name, color) {
    const c = { id: categories.length + 1, ...makeCategory(name, color, categories) };
    categories.push(c);
    return c;
  },
  async transactions(month, card) { await sleep(); return rowsOf(month, card); },
  async summary(month, card): Promise<MonthSummary> {
    await sleep();
    const rows = rowsOf(month, card);
    const prevMonth = monthsDesc(card).filter((m) => m < month)[0] ?? null;
    const byCat = new Map<string, { key: string; name: string; color: string; amount: number; count: number }>();
    const byMerchant = new Map<string, { merchant: string; amount: number; count: number }>();
    for (const t of rows) {
      const c = categories.find((x) => x.key === t.categoryKey)!;
      const e = byCat.get(c.key) ?? { key: c.key, name: c.name, color: c.color, amount: 0, count: 0 };
      e.amount += t.chargedAmount; e.count++; byCat.set(c.key, e);
      const m = byMerchant.get(t.merchant) ?? { merchant: t.merchant, amount: 0, count: 0 };
      m.amount += t.chargedAmount; m.count++; byMerchant.set(t.merchant, m);
    }
    return {
      month, total: rows.reduce((s, t) => s + t.chargedAmount, 0), prevMonth,
      prevTotal: prevMonth ? rowsOf(prevMonth, card).reduce((s, t) => s + t.chargedAmount, 0) : null,
      transactionCount: rows.length, cards: [...new Set(rows.map((t) => t.cardLast4))], byCard: totalsByCard(rows),
      byCategory: [...byCat.values()].sort((a, b) => b.amount - a.amount),
      topMerchants: [...byMerchant.values()].sort((a, b) => b.amount - a.amount).slice(0, 5),
    };
  },
  async setCategory(id, key, all) {
    const t = data.find((x) => x.id === id);
    if (!t) return;
    for (const x of data) if (x.id === id || (all && x.merchant === t.merchant)) x.categoryKey = key;
  },
  async setFlag(id, kind, comment) {
    const t = data.find((x) => x.id === id);
    if (!t) return;
    const text = comment.trim();
    if (text.length > MAX_FLAG_COMMENT) throw new Error(`ההערה ארוכה מדי (עד ${MAX_FLAG_COMMENT} תווים)`);
    const meta = flagMeta.get(id);
    if (!meta) flagMeta.set(id, { createdAt: new Date().toISOString(), resolvedAt: null });
    t.flag = { kind, comment: text, resolved: t.flag?.resolved ?? false };
  },
  async resolveFlag(id, resolved) {
    const t = data.find((x) => x.id === id);
    const meta = flagMeta.get(id);
    if (!t?.flag || !meta) return;
    t.flag.resolved = resolved;
    meta.resolvedAt = resolved ? new Date().toISOString() : null;
  },
  async clearFlag(id) {
    const t = data.find((x) => x.id === id);
    if (t) delete t.flag;
    flagMeta.delete(id);
  },
  async flags(): Promise<FlaggedTx[]> {
    await sleep();
    return data
      .filter((t) => t.flag && flagMeta.has(t.id))
      .map((t) => ({
        txId: t.id, kind: t.flag!.kind, comment: t.flag!.comment, resolved: t.flag!.resolved,
        createdAt: flagMeta.get(t.id)!.createdAt, resolvedAt: flagMeta.get(t.id)!.resolvedAt,
        merchant: t.merchant, purchaseDate: t.purchaseDate, chargedAmount: t.chargedAmount,
        originalAmount: t.originalAmount, originalCurrency: t.originalCurrency,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async setInsightFlag(month, insight, comment) {
    const key = insightFlagKey(month, insight.id);
    const existing = insightFlags.get(key);
    insightFlags.set(key, existing
      ? { ...existing, comment: comment.trim() }
      : { key, month, insightKind: insight.kind, text: insight.text, comment: comment.trim(), resolved: false, createdAt: new Date().toISOString(), resolvedAt: null });
  },
  async resolveInsightFlag(key, resolved) {
    const f = insightFlags.get(key);
    if (f) insightFlags.set(key, { ...f, resolved, resolvedAt: resolved ? new Date().toISOString() : null });
  },
  async clearInsightFlag(key) { insightFlags.delete(key); },
  async insightFlags() { return [...insightFlags.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); },
  async insights(month, card) {
    await sleep();
    return insightsFor({
      month, card, all: data,
      categoryNames: Object.fromEntries(categories.map((c) => [c.key, c.name])),
    });
  },
  async budgets() { return budgets; },
  async setBudget(key, amount) {
    const i = budgets.findIndex((b) => b.categoryKey === key);
    if (i >= 0) budgets.splice(i, 1);
    if (amount && amount > 0) budgets.push({ categoryKey: key, monthlyAmount: amount });
  },
  async monthlyTarget() { return monthlyTarget; },
  async setMonthlyTarget(amount) { monthlyTarget = amount && amount > 0 ? amount : null; },
  async importFiles(files): Promise<ImportResult[]> {
    return files.map((f) => ({ file: f.name, ok: false, error: 'ייבוא קבצים לא זמין בתצוגת דוגמה' }));
  },
  async exportBackup() { return JSON.stringify(makeBackup(emptyData())); },
  async restoreBackup() { return { ok: false, error: 'שחזור גיבוי לא זמין בתצוגת דוגמה' }; },
};
