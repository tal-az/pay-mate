import { findProvider } from '../providers';
import type { CardInfo, CardTotal } from '../api';

interface OnCard {
  company: string;
  cardLast4: string;
}

/** Identifies a card across companies, since two companies can issue cards with the same last four digits. */
export const cardKey = (t: OnCard) => `${t.company}:${t.cardLast4}`;

export function filterByCard<T extends OnCard>(rows: T[], card?: string): T[] {
  return card ? rows.filter((t) => cardKey(t) === card) : rows;
}

export const companyName = (company: string) => findProvider(company)?.name ?? company;

export const cardLabel = (company: string, last4: string) => `${companyName(company)} ${last4}`;

/** The amount and number of charges on each card, largest first. */
export function totalsByCard(rows: Array<OnCard & { chargedAmount: number }>): CardTotal[] {
  const totals = new Map<string, CardTotal>();
  for (const t of rows) {
    const key = cardKey(t);
    const e = totals.get(key) ?? { key, company: t.company, last4: t.cardLast4, amount: 0, count: 0 };
    e.amount += t.chargedAmount;
    e.count += 1;
    totals.set(key, e);
  }
  return [...totals.values()].sort((a, b) => b.amount - a.amount);
}

/**
 * Every card with the time its company was last updated. Imports from before companies were recorded on them
 * have none, so they stand in for any company without a newer one.
 */
export function listCards(rows: OnCard[], imports: Array<{ at: string; company?: string | null }>): CardInfo[] {
  const latest = new Map<string, string>();
  let untagged: string | null = null;
  for (const i of imports) {
    if (!i.company) {
      if (!untagged || i.at > untagged) untagged = i.at;
    } else if (i.at > (latest.get(i.company) ?? '')) {
      latest.set(i.company, i.at);
    }
  }
  const cards = new Map<string, CardInfo>();
  for (const t of rows) {
    const key = cardKey(t);
    if (!cards.has(key)) cards.set(key, { key, company: t.company, last4: t.cardLast4, updatedAt: latest.get(t.company) ?? untagged });
  }
  return [...cards.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
}

export interface CompanyCards {
  company: string;
  cards: string[];
  updatedAt: string | null;
}

export function byCompany(cards: CardInfo[]): CompanyCards[] {
  const companies = new Map<string, CompanyCards>();
  for (const c of cards) {
    const e = companies.get(c.company) ?? { company: c.company, cards: [], updatedAt: c.updatedAt };
    e.cards.push(c.last4);
    companies.set(c.company, e);
  }
  return [...companies.values()];
}
