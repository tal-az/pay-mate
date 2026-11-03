import type { Insight, TimelineRow, TxRow } from '../api';
import { cardKey, filterByCard } from './cards';

const MONTH_NAMES = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

export function monthLabel(month: string): string {
  const [y, m] = month.split('-');
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}

export function monthOf(tx: Pick<TxRow, 'chargeDate' | 'purchaseDate'>): string {
  return (tx.chargeDate ?? tx.purchaseDate).slice(0, 7);
}

const ils = (n: number) => `₪${Math.round(n).toLocaleString('he-IL')}`;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function sum(rows: TxRow[]): number {
  return rows.reduce((s, t) => s + t.chargedAmount, 0);
}

function dayNumber(iso: string): number {
  return Math.floor(Date.parse(iso) / 86_400_000);
}

export interface InsightInput {
  month: string;
  prevMonth: string | null;
  /** Every transaction in the database. */
  all: TxRow[];
  categoryNames: Record<string, string>;
  /** Transactions on every card, when `all` covers only one. A charge that moved to another card shows up here. */
  everyCard?: TxRow[];
}

/** The insights of all cards, or of one. Ids differ between the two, so following up in one view does not mark the other. */
export function insightsFor({ month, card, all, categoryNames }: Omit<InsightInput, 'prevMonth' | 'everyCard'> & { card?: string }): Insight[] {
  const scoped = filterByCard(all, card);
  const prevMonth = [...new Set(scoped.map(monthOf))].filter((m) => m < month).sort().pop() ?? null;
  const insights = buildInsights({ month, prevMonth, all: scoped, categoryNames, everyCard: all });
  return card ? insights.map((i) => ({ ...i, id: `${card}/${i.id}` })) : insights;
}

export function buildInsights({ month, prevMonth, all, categoryNames, everyCard = all }: InsightInput): Insight[] {
  const out: Insight[] = [];
  const cur = all.filter((t) => monthOf(t) === month);
  if (cur.length === 0) return out;
  const prev = prevMonth ? all.filter((t) => monthOf(t) === prevMonth) : [];
  const curTotal = sum(cur);

  if (prevMonth && prev.length > 0) {
    const prevTotal = sum(prev);
    const diff = curTotal - prevTotal;
    if (Math.abs(diff) >= 50) {
      out.push({
        id: 'trend-total',
        kind: 'trend',
        attention: diff > 0 && diff / prevTotal > 0.15,
        text: diff > 0
          ? `הוצאת ${ils(diff)} יותר מאשר ב${monthLabel(prevMonth)}.`
          : `הוצאת ${ils(-diff)} פחות מאשר ב${monthLabel(prevMonth)}.`,
        txIds: [],
      });
    }
    const byCat = (rows: TxRow[]) => {
      const m = new Map<string, number>();
      for (const t of rows) m.set(t.categoryKey, (m.get(t.categoryKey) ?? 0) + t.chargedAmount);
      return m;
    };
    const a = byCat(cur);
    const b = byCat(prev);
    let best: { key: string; diff: number } | null = null;
    for (const [key, amount] of a) {
      const d = amount - (b.get(key) ?? 0);
      if (key !== 'other' && d >= 100 && d / Math.max(b.get(key) ?? 0, 1) > 0.2 && (!best || d > best.diff)) {
        best = { key, diff: d };
      }
    }
    if (best) {
      out.push({
        id: `trend-cat-${best.key}`,
        kind: 'trend',
        attention: true,
        text: `ב${categoryNames[best.key] ?? best.key} הוצאת ${ils(best.diff)} יותר מהחודש הקודם.`,
        txIds: cur.filter((t) => t.categoryKey === best!.key).map((t) => t.id),
      });
    }
  }

  // Subscriptions: standing orders, or the same merchant at a similar amount in 3+ months.
  const byMerchant = new Map<string, TxRow[]>();
  for (const t of all) {
    const list = byMerchant.get(t.merchant) ?? [];
    list.push(t);
    byMerchant.set(t.merchant, list);
  }
  const monthsKnown = new Set(all.map(monthOf));
  for (const [merchant, rows] of byMerchant) {
    const thisMonth = rows.filter((t) => monthOf(t) === month);
    if (thisMonth.length === 0) continue;
    const months = new Set(rows.map(monthOf));
    const amounts = rows.map((t) => t.chargedAmount);
    const m = median(amounts);
    const steady = m > 0 && amounts.every((x) => Math.abs(x - m) / m <= 0.1);
    const recurring = months.size >= 3 && steady;
    const firstSeenNow = months.size === 1 && monthsKnown.size >= 2;
    if (recurring) {
      out.push({
        id: `sub-${merchant}`,
        kind: 'subscription',
        attention: false,
        text: `${merchant}: חיוב חוזר של כ־${ils(m)} בחודש.`,
        txIds: thisMonth.map((t) => t.id),
      });
    } else if (firstSeenNow && thisMonth.some((t) => t.standingOrder)) {
      out.push({
        id: `sub-new-${merchant}`,
        kind: 'subscription',
        attention: true,
        text: `חיוב חוזר חדש: ${merchant}, ${ils(thisMonth[0].chargedAmount)}.`,
        txIds: thisMonth.map((t) => t.id),
      });
    }
  }

  // Unusual: far above the merchant's usual charge, or a big first-time charge.
  for (const [merchant, rows] of byMerchant) {
    const thisMonth = rows.filter((t) => monthOf(t) === month);
    const earlier = rows.filter((t) => monthOf(t) !== month);
    for (const t of thisMonth) {
      if (earlier.length >= 3 && t.chargedAmount > 3 * median(earlier.map((x) => x.chargedAmount)) && t.chargedAmount >= 100) {
        out.push({
          id: `unusual-${t.id}`,
          kind: 'unusual',
          attention: true,
          text: `${merchant}: חיוב של ${ils(t.chargedAmount)}, הרבה מעל הרגיל.`,
          txIds: [t.id],
        });
      } else if (earlier.length === 0 && rows.length === thisMonth.length && monthsKnown.size >= 2 && t.chargedAmount >= 500) {
        out.push({
          id: `unusual-new-${t.id}`,
          kind: 'unusual',
          attention: true,
          text: `חיוב גדול מבית עסק חדש: ${merchant}, ${ils(t.chargedAmount)}.`,
          txIds: [t.id],
        });
      }
    }
  }

  // Duplicates: same card, merchant and amount within a day. On two cards it is more likely two people paying.
  const seen = new Set<string>();
  for (const t of cur) {
    for (const u of cur) {
      if (t.id >= u.id || cardKey(t) !== cardKey(u) || t.merchant !== u.merchant || t.chargedAmount !== u.chargedAmount) continue;
      if (Math.abs(dayNumber(t.purchaseDate) - dayNumber(u.purchaseDate)) > 1) continue;
      const key = `${cardKey(t)}|${t.merchant}|${t.chargedAmount}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: `dup-${t.id}`,
        kind: 'duplicate',
        attention: true,
        text: `ייתכן חיוב כפול: ${t.merchant}, ${ils(t.chargedAmount)}, פעמיים בתוך יום.`,
        txIds: [t.id, u.id],
      });
    }
  }

  out.push(...recurringInsights(month, all, everyCard, categoryNames));

  return out.sort((x, y) => Number(y.attention) - Number(x.attention));
}

interface Series {
  merchant: string;
  card: string;
  company: string;
  cardLast4: string;
  /** Total charged per billing month. */
  perMonth: Map<string, number>;
  /** Number of charges per billing month. */
  counts: Map<string, number>;
  txIds: Map<string, string[]>;
  median: number;
}

/** The average single charge in a month, so a double charge does not look like a price change. */
const unit = (s: Series, month: string) => s.perMonth.get(month)! / s.counts.get(month)!;

/** A charge that shows up in 3+ months at a similar amount (within 25% of its median). */
function recurringSeries(all: TxRow[]): Series[] {
  const groups = new Map<string, Series>();
  for (const t of all) {
    const key = `${cardKey(t)}|${t.merchant}`;
    const s = groups.get(key) ?? {
      merchant: t.merchant, card: cardKey(t), company: t.company, cardLast4: t.cardLast4, perMonth: new Map(), counts: new Map(), txIds: new Map(), median: 0,
    };
    const m = monthOf(t);
    s.perMonth.set(m, (s.perMonth.get(m) ?? 0) + t.chargedAmount);
    s.counts.set(m, (s.counts.get(m) ?? 0) + 1);
    s.txIds.set(m, [...(s.txIds.get(m) ?? []), t.id]);
    groups.set(key, s);
  }
  const out: Series[] = [];
  for (const s of groups.values()) {
    if (s.perMonth.size < 3) continue;
    const amounts = [...s.perMonth.keys()].map((m) => unit(s, m));
    const med = median(amounts);
    if (med <= 0 || !amounts.every((a) => Math.abs(a - med) / med <= 0.25)) continue;
    s.median = med;
    out.push(s);
  }
  return out;
}

/** True when a similar charge from this merchant landed on another card after `lastSeen`, up to `month`: it moved, it did not stop. */
function movedToOtherCard(s: Series, lastSeen: string, month: string, everyCard: TxRow[]): boolean {
  return everyCard.some((t) => {
    if (t.merchant !== s.merchant || cardKey(t) === s.card) return false;
    const m = monthOf(t);
    return m > lastSeen && m <= month && Math.abs(t.chargedAmount - s.median) / s.median <= 0.25;
  });
}

/** A card's month only counts as "covered" if that card has charges in it, so a missing statement is not a hole. */
function monthsCoveredByCard(all: TxRow[]): Map<string, Set<string>> {
  const covered = new Map<string, Set<string>>();
  for (const t of all) {
    const set = covered.get(cardKey(t)) ?? new Set<string>();
    set.add(monthOf(t));
    covered.set(cardKey(t), set);
  }
  return covered;
}

function recurringInsights(month: string, all: TxRow[], everyCard: TxRow[], _categoryNames: Record<string, string>): Insight[] {
  const out: Insight[] = [];
  const series = recurringSeries(all);
  const coveredByCard = monthsCoveredByCard(all);

  let activeCount = 0;
  let activeTotal = 0;

  for (const s of series) {
    const covered = [...(coveredByCard.get(s.card) ?? [])].filter((m) => m <= month).sort();
    if (!covered.includes(month)) continue;
    const present = s.perMonth.has(month);
    const earlier = covered.filter((m) => m < month);

    if (present) {
      activeCount++;
      activeTotal += s.median;
      const prior = earlier.filter((m) => s.perMonth.has(m));
      const count = s.counts.get(month) ?? 0;
      if (count >= 2 && prior.length >= 2 && prior.every((m) => s.counts.get(m) === 1)) {
        out.push({
          id: `rec-double-${s.card}-${s.merchant}`,
          kind: 'missing',
          attention: true,
          text: `${s.merchant} חויב ${count} פעמים ב${monthLabel(month)}, ובדרך כלל חייבים פעם אחת בחודש.`,
          txIds: s.txIds.get(month) ?? [],
        });
      }
      if (prior.length >= 2) {
        const usual = median(prior.map((m) => unit(s, m)));
        const now = unit(s, month);
        if (usual > 0 && Math.abs(now - usual) >= 1 && Math.abs(now - usual) / usual >= 0.05) {
          const up = now > usual;
          out.push({
            id: `rec-price-${s.card}-${s.merchant}`,
            kind: 'price',
            attention: up,
            text: `${s.merchant}: המחיר ${up ? 'עלה' : 'ירד'} מ־${ils(usual)} ל־${ils(now)} בחודש.`,
            txIds: s.txIds.get(month) ?? [],
          });
        }
      }
      continue;
    }

    // Not charged this month: count the run of covered months without a charge, ending now.
    let gap = 0;
    for (let i = covered.length - 1; i >= 0 && !s.perMonth.has(covered[i]); i--) gap++;
    const lastSeen = covered[covered.length - 1 - gap];
    if (!lastSeen) continue;
    const before = covered.filter((m) => m <= lastSeen && s.perMonth.has(m));
    if (before.length < 3) continue;
    if (movedToOtherCard(s, lastSeen, month, everyCard)) continue;

    if (gap === 1) {
      out.push({
        id: `rec-missing-${s.card}-${s.merchant}`,
        kind: 'missing',
        attention: true,
        text: `${s.merchant} לא חויב ב${monthLabel(month)}, אבל חויב ב${before.length} החודשים הקודמים (בדרך כלל ${ils(s.median)}). ייתכן שבוטל, או שהחיוב יגיע בחודש הבא.`,
        txIds: [],
      });
    } else {
      out.push({
        id: `rec-stopped-${s.card}-${s.merchant}`,
        kind: 'missing',
        attention: false,
        text: `נראה ש${s.merchant} הפסיק: אין חיוב כבר ${gap} חודשים (בדרך כלל ${ils(s.median)}).`,
        txIds: [],
      });
    }
  }

  if (activeCount >= 2) {
    out.push({
      id: 'rec-commitments',
      kind: 'commitments',
      attention: false,
      text: `יש ${activeCount} חיובים קבועים, בסך כ־${ils(activeTotal)} בחודש.`,
      txIds: [],
    });
  }
  return out;
}

/** One row per recurring charge, with a cell for each of the last `limit` months, so missing months show as holes. */
export function recurringTimeline(everyCard: TxRow[], limit: number, card?: string): TimelineRow[] {
  const all = filterByCard(everyCard, card);
  const months = [...new Set(all.map(monthOf))].sort().slice(-limit);
  const coveredByCard = monthsCoveredByCard(all);
  const rows: TimelineRow[] = recurringSeries(all).map((s) => {
    const covered = coveredByCard.get(s.card) ?? new Set<string>();
    const charged = [...s.perMonth.keys()].sort();
    const cells = months.map((month) => {
      const lastSeen = charged.filter((m) => m < month).pop();
      const moved = !s.perMonth.has(month) && lastSeen !== undefined && movedToOtherCard(s, lastSeen, month, everyCard);
      return { month, amount: s.perMonth.get(month) ?? null, covered: covered.has(month) && !moved };
    });
    // A hole is a covered month without a charge, between the first and the last time it was charged.
    const seen = cells.filter((c) => c.amount != null).map((c) => c.month);
    const first = seen[0];
    const holes = cells.filter((c) => c.covered && c.amount == null && first !== undefined && c.month > first).length;
    return { merchant: s.merchant, card: s.card, company: s.company, cardLast4: s.cardLast4, usual: s.median, cells, holes };
  });
  return rows.sort((a, b) => b.holes - a.holes || b.usual - a.usual);
}
