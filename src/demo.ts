import { buildInsights, monthOf, recurringTimeline } from '../electron/core/insights';
import { CATEGORY_SEEDS } from '../electron/core/categorize';
import type {
  Budget, Category, ImportResult, MonthSummary, PayMateApi, TxRow,
} from '../shared/api';

/** Synthetic data so the interface can be developed and previewed in a plain browser. */
const categories: Category[] = CATEGORY_SEEDS.map((c, i) => ({ id: i + 1, key: c.key, name: c.name, color: c.color }));

let n = 0;
function tx(month: string, day: string, merchant: string, key: string, amount: number, extra: Partial<TxRow> = {}): TxRow {
  const [y, m] = month.split('-').map(Number);
  const purchaseMonth = day === '28' || day === '29' || day === '25' ? (m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`) : month;
  return {
    id: `demo-${++n}`, purchaseDate: `${purchaseMonth}-${day}`, chargeDate: `${month}-02`, merchant, categoryKey: key,
    chargedAmount: amount, originalAmount: amount, originalCurrency: 'ILS', standingOrder: false, foreignSite: false,
    discount: 0, cardLast4: '1958', ...extra,
  };
}

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

const budgets: Budget[] = [{ categoryKey: 'groceries', monthlyAmount: 700 }, { categoryKey: 'restaurants', monthlyAmount: 300 }];

const sleep = () => new Promise((r) => setTimeout(r, 20));
const monthsDesc = () => [...new Set(data.map(monthOf))].sort().reverse();
const rowsOf = (month: string) => data.filter((t) => monthOf(t) === month).sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate));

export const demoApi: PayMateApi = {
  async months() { await sleep(); return monthsDesc(); },
  async monthTotals() {
    return monthsDesc().slice().reverse().map((m) => ({ month: m, total: rowsOf(m).reduce((s, t) => s + t.chargedAmount, 0) }));
  },
  async recurringTimeline() { return recurringTimeline(data, 6); },
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
  async categories() { return categories; },
  async transactions(month) { await sleep(); return rowsOf(month); },
  async summary(month): Promise<MonthSummary> {
    await sleep();
    const rows = rowsOf(month);
    const prevMonth = monthsDesc().filter((m) => m < month)[0] ?? null;
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
      prevTotal: prevMonth ? rowsOf(prevMonth).reduce((s, t) => s + t.chargedAmount, 0) : null,
      transactionCount: rows.length, cards: ['1958'],
      byCategory: [...byCat.values()].sort((a, b) => b.amount - a.amount),
      topMerchants: [...byMerchant.values()].sort((a, b) => b.amount - a.amount).slice(0, 5),
    };
  },
  async setCategory(id, key, all) {
    const t = data.find((x) => x.id === id);
    if (!t) return;
    for (const x of data) if (x.id === id || (all && x.merchant === t.merchant)) x.categoryKey = key;
  },
  async insights(month) {
    await sleep();
    return buildInsights({
      month, prevMonth: monthsDesc().filter((m) => m < month)[0] ?? null, all: data,
      categoryNames: Object.fromEntries(categories.map((c) => [c.key, c.name])),
    });
  },
  async budgets() { return budgets; },
  async setBudget(key, amount) {
    const i = budgets.findIndex((b) => b.categoryKey === key);
    if (i >= 0) budgets.splice(i, 1);
    if (amount && amount > 0) budgets.push({ categoryKey: key, monthlyAmount: amount });
  },
  async pickFiles() { return []; },
  async importFiles(paths): Promise<ImportResult[]> {
    return paths.map((p) => ({ file: p, ok: false, error: 'ייבוא קבצים זמין רק באפליקציה המותקנת' }));
  },
  async sync() {
    return { ok: false, failure: 'unknown' as const, message: 'סנכרון זמין רק באפליקציה המותקנת' };
  },
  onSyncProgress: () => () => undefined,
  async appVersion() { return 'demo'; },
  async checkForUpdates() {},
  async installUpdate() {},
  onUpdateStatus: () => () => undefined,
  pathForFile: (f) => f.name,
};
