import { HEX_COLOR, MAX_CATEGORY_NAME, SEED_KEYS } from './core/categorize';
import { FLAG_KINDS, MAX_FLAG_COMMENT, type FlagKind, type InsightFlag, type TxFlag } from './api';
import type { Source } from './types';

/**
 * The backup file is the exchange format between the desktop app (SQLite) and the website (IndexedDB), so it uses
 * category keys rather than database ids, and carries every field either side needs to behave the same.
 */
export const BACKUP_FORMAT = 'paymate-backup';
export const BACKUP_VERSION = 1;

export interface BackupTransaction {
  id: string;
  company: string;
  cardLast4: string;
  purchaseDate: string;
  chargeDate: string | null;
  rawMerchant: string;
  merchant: string;
  originalAmount: number;
  originalCurrency: string;
  chargedAmount: number;
  chargedCurrency: string;
  voucher: string | null;
  standingOrder: boolean;
  foreignSite: boolean;
  discount: number;
  details: string;
  categoryKey: string;
  categoryLocked: boolean;
  source: Source;
}

export interface BackupRule {
  /** Lower-cased merchant name the rule matches. */
  pattern: string;
  categoryKey: string;
  origin: string;
}

/** A category the user made; the built-in ones are not stored. */
export interface BackupCategory {
  key: string;
  name: string;
  color: string;
}

export interface BackupReview {
  merchantKey: string;
  decidedAt: string;
}

export interface BackupBudget {
  categoryKey: string;
  monthlyAmount: number;
}

export interface BackupImport {
  at: string;
  source: Source;
  label: string;
  added: number;
  skipped: number;
}

/** Everything the app stores. The website keeps exactly this document in IndexedDB. */
export interface BackupData {
  flags: TxFlag[];
  insightFlags: InsightFlag[];
  categories: BackupCategory[];
  transactions: BackupTransaction[];
  rules: BackupRule[];
  reviews: BackupReview[];
  budgets: BackupBudget[];
  imports: BackupImport[];
}

export interface Backup extends BackupData {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
}

export const emptyData = (): BackupData => ({ categories: [], transactions: [], rules: [], reviews: [], budgets: [], imports: [], flags: [], insightFlags: [] });

export function makeBackup(data: BackupData): Backup {
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), ...data };
}

export class BackupError extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

type Obj = Record<string, unknown>;

function obj(value: unknown, where: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new BackupError(`הקובץ פגום (${where})`);
  return value as Obj;
}

function list(root: Obj, key: string): unknown[] {
  const v = root[key];
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new BackupError(`הקובץ פגום (${key})`);
  return v;
}

const text = (o: Obj, k: string, where: string): string => {
  if (typeof o[k] !== 'string') throw new BackupError(`הקובץ פגום (${where}: ${k})`);
  return o[k] as string;
};
const textOr = (o: Obj, k: string, fallback: string): string => (typeof o[k] === 'string' ? (o[k] as string) : fallback);
const nullableText = (o: Obj, k: string): string | null => (typeof o[k] === 'string' ? (o[k] as string) : null);
const num = (o: Obj, k: string, where: string): number => {
  if (typeof o[k] !== 'number' || !Number.isFinite(o[k])) throw new BackupError(`הקובץ פגום (${where}: ${k})`);
  return o[k] as number;
};
const flag = (o: Obj, k: string): boolean => o[k] === true || o[k] === 1;
const source = (o: Obj): Source => (o.source === 'sync' ? 'sync' : 'excel');
/** A category this version doesn't know (from a newer app) falls back to "other". */
const knownKey = (k: unknown, keys: Set<string>): string => (typeof k === 'string' && keys.has(k) ? k : 'other');

/** Validates a backup file. Throws BackupError with a Hebrew message; never returns partial data. */
export function parseBackup(raw: string): BackupData {
  let root: Obj;
  try {
    root = obj(JSON.parse(raw), 'root');
  } catch (e) {
    throw e instanceof BackupError ? e : new BackupError('זה לא קובץ גיבוי של PayMate');
  }
  if (root.format !== BACKUP_FORMAT) throw new BackupError('זה לא קובץ גיבוי של PayMate');
  if (typeof root.version !== 'number' || root.version > BACKUP_VERSION) {
    throw new BackupError('הגיבוי נוצר בגרסה חדשה יותר של PayMate. עדכנו את האפליקציה ונסו שוב.');
  }

  const customs = new Map<string, BackupCategory>();
  list(root, 'categories').forEach((item, i) => {
    const o = obj(item, `קטגוריה ${i + 1}`);
    const key = text(o, 'key', `קטגוריה ${i + 1}`);
    const name = text(o, 'name', `קטגוריה ${i + 1}`).trim().slice(0, MAX_CATEGORY_NAME);
    const color = text(o, 'color', `קטגוריה ${i + 1}`);
    if (SEED_KEYS.has(key) || !name || !HEX_COLOR.test(color)) return;
    customs.set(key, { key, name, color });
  });
  const CATEGORY_KEYS = new Set([...SEED_KEYS, ...customs.keys()]);

  const seen = new Set<string>();
  const transactions: BackupTransaction[] = [];
  list(root, 'transactions').forEach((item, i) => {
    const where = `עסקה ${i + 1}`;
    const o = obj(item, where);
    const id = text(o, 'id', where);
    const purchaseDate = text(o, 'purchaseDate', where);
    const chargeDate = nullableText(o, 'chargeDate');
    if (!DATE.test(purchaseDate) || (chargeDate !== null && !DATE.test(chargeDate))) throw new BackupError(`הקובץ פגום (${where}: תאריך)`);
    if (seen.has(id)) return;
    seen.add(id);
    transactions.push({
      id,
      company: textOr(o, 'company', 'isracard'),
      cardLast4: text(o, 'cardLast4', where),
      purchaseDate,
      chargeDate,
      rawMerchant: textOr(o, 'rawMerchant', text(o, 'merchant', where)),
      merchant: text(o, 'merchant', where),
      originalAmount: num(o, 'originalAmount', where),
      originalCurrency: textOr(o, 'originalCurrency', 'ILS'),
      chargedAmount: num(o, 'chargedAmount', where),
      chargedCurrency: textOr(o, 'chargedCurrency', 'ILS'),
      voucher: nullableText(o, 'voucher'),
      standingOrder: flag(o, 'standingOrder'),
      foreignSite: flag(o, 'foreignSite'),
      discount: typeof o.discount === 'number' && Number.isFinite(o.discount) ? o.discount : 0,
      details: textOr(o, 'details', ''),
      categoryKey: knownKey(o.categoryKey, CATEGORY_KEYS),
      categoryLocked: flag(o, 'categoryLocked'),
      source: source(o),
    });
  });

  const rules = new Map<string, BackupRule>();
  list(root, 'rules').forEach((item, i) => {
    const o = obj(item, `כלל ${i + 1}`);
    // A rule for a category this version lacks is dropped: mapping it to "other" would change future imports.
    if (typeof o.categoryKey !== 'string' || !CATEGORY_KEYS.has(o.categoryKey)) return;
    const pattern = text(o, 'pattern', `כלל ${i + 1}`);
    rules.set(pattern, { pattern, categoryKey: o.categoryKey, origin: textOr(o, 'origin', 'user') });
  });

  const reviews = new Map<string, BackupReview>();
  list(root, 'reviews').forEach((item, i) => {
    const o = obj(item, `סקירה ${i + 1}`);
    const merchantKey = text(o, 'merchantKey', `סקירה ${i + 1}`);
    reviews.set(merchantKey, { merchantKey, decidedAt: textOr(o, 'decidedAt', new Date(0).toISOString()) });
  });

  const budgets = new Map<string, BackupBudget>();
  list(root, 'budgets').forEach((item, i) => {
    const o = obj(item, `תקציב ${i + 1}`);
    if (typeof o.categoryKey !== 'string' || !CATEGORY_KEYS.has(o.categoryKey)) return;
    const monthlyAmount = num(o, 'monthlyAmount', `תקציב ${i + 1}`);
    if (monthlyAmount > 0) budgets.set(o.categoryKey, { categoryKey: o.categoryKey, monthlyAmount });
  });

  const imports = list(root, 'imports').map((item, i): BackupImport => {
    const o = obj(item, `ייבוא ${i + 1}`);
    return {
      at: text(o, 'at', `ייבוא ${i + 1}`),
      source: source(o),
      label: textOr(o, 'label', ''),
      added: typeof o.added === 'number' ? o.added : 0,
      skipped: typeof o.skipped === 'number' ? o.skipped : 0,
    };
  });

  // A flag whose transaction is missing or whose kind this version lacks is dropped; there is nothing to show it on.
  const flags = new Map<string, TxFlag>();
  list(root, 'flags').forEach((item, i) => {
    const o = obj(item, `דגל ${i + 1}`);
    const txId = text(o, 'txId', `דגל ${i + 1}`);
    if (!seen.has(txId) || !FLAG_KINDS.includes(o.kind as FlagKind)) return;
    const resolved = flag(o, 'resolved');
    flags.set(txId, {
      txId,
      kind: o.kind as FlagKind,
      comment: textOr(o, 'comment', '').slice(0, MAX_FLAG_COMMENT),
      resolved,
      createdAt: textOr(o, 'createdAt', new Date(0).toISOString()),
      resolvedAt: resolved ? textOr(o, 'resolvedAt', new Date(0).toISOString()) : null,
    });
  });

  const insightFlags = new Map<string, InsightFlag>();
  list(root, 'insightFlags').forEach((item, i) => {
    const where = `דגל תובנה ${i + 1}`;
    const o = obj(item, where);
    const key = text(o, 'key', where);
    const resolved = flag(o, 'resolved');
    insightFlags.set(key, {
      key,
      month: text(o, 'month', where),
      insightKind: textOr(o, 'insightKind', ''),
      text: text(o, 'text', where),
      comment: textOr(o, 'comment', '').slice(0, MAX_FLAG_COMMENT),
      resolved,
      createdAt: textOr(o, 'createdAt', new Date(0).toISOString()),
      resolvedAt: resolved ? textOr(o, 'resolvedAt', new Date(0).toISOString()) : null,
    });
  });

  return {
    categories: [...customs.values()], transactions, rules: [...rules.values()], reviews: [...reviews.values()],
    budgets: [...budgets.values()], imports, flags: [...flags.values()], insightFlags: [...insightFlags.values()],
  };
}
