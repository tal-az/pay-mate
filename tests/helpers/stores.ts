import { join } from 'node:path';
import {
  openDb, addCategory, importStatement, setCategory, assignMerchant, keepMerchantAsOther, undoMerchant, setFlag, resolveFlag, clearFlag,
  setInsightFlag, resolveInsightFlag, clearInsightFlag,
} from '../../electron/db/db';
import {
  allTransactions, lastUpdate, listCards, listCategories, listBudgets, listFlags, listInsightFlags, listMonths, monthSummary, monthTransactions, setBudget, unknownMerchants,
} from '../../electron/db/queries';
import { exportData, restoreData } from '../../electron/db/backup';
import * as web from '../../src/web/logic';
import { emptyData, type BackupData } from '../../shared/backup';
import type { Budget, CardInfo, Category, FlagKind, FlaggedTx, InsightFlag, LastUpdate, MonthSummary, TxRow, UnknownMerchant } from '../../shared/api';
import type { ParsedStatement, ParsedTransaction, Source } from '../../shared/types';

/** The same operations on both implementations: the desktop's SQLite and the website's plain document. */
export interface Store {
  importStatement(stmt: ParsedStatement, label: string, source: Source): { added: number; skipped: number };
  setCategory(txId: string, key: string, all: boolean): void;
  assignMerchant(merchant: string, key: string): number;
  keepMerchantAsOther(merchant: string): void;
  undoMerchant(merchant: string): void;
  setBudget(key: string, amount: number | null): void;
  addCategory(name: string, color: string): Category;
  categories(): Category[];
  unknownMerchants(month: string): UnknownMerchant[];
  monthTransactions(month: string, card?: string): TxRow[];
  allTransactions(): TxRow[];
  listMonths(): string[];
  monthSummary(month: string, card?: string): MonthSummary;
  cards(): CardInfo[];
  lastUpdate(): LastUpdate | null;
  budgets(): Budget[];
  setFlag(txId: string, kind: FlagKind, comment: string): void;
  resolveFlag(txId: string, resolved: boolean): void;
  clearFlag(txId: string): void;
  flags(): FlaggedTx[];
  setInsightFlag(month: string, insight: { id: string; kind: string; text: string }, comment: string): void;
  resolveInsightFlag(key: string, resolved: boolean): void;
  clearInsightFlag(key: string): void;
  insightFlags(): InsightFlag[];
  exportData(): BackupData;
  restoreData(data: BackupData): void;
}

export function sqliteStore(): Store {
  const db = openDb(':memory:', join(__dirname, '../../electron/db'));
  return {
    importStatement: (s, l, src) => importStatement(db, s, l, src),
    setCategory: (id, k, all) => setCategory(db, id, k, all),
    assignMerchant: (m, k) => assignMerchant(db, m, k),
    keepMerchantAsOther: (m) => keepMerchantAsOther(db, m),
    undoMerchant: (m) => undoMerchant(db, m),
    setBudget: (k, a) => setBudget(db, k, a),
    addCategory: (n, c) => addCategory(db, n, c),
    categories: () => listCategories(db),
    unknownMerchants: (m) => unknownMerchants(db, m),
    monthTransactions: (m, c) => monthTransactions(db, m, c),
    allTransactions: () => allTransactions(db),
    listMonths: () => listMonths(db),
    monthSummary: (m, c) => monthSummary(db, m, c),
    cards: () => listCards(db),
    lastUpdate: () => lastUpdate(db),
    budgets: () => listBudgets(db),
    setFlag: (id, k, c) => setFlag(db, id, k, c),
    resolveFlag: (id, r) => resolveFlag(db, id, r),
    clearFlag: (id) => clearFlag(db, id),
    flags: () => listFlags(db),
    setInsightFlag: (m, i, c) => setInsightFlag(db, m, i, c),
    resolveInsightFlag: (k, r) => resolveInsightFlag(db, k, r),
    clearInsightFlag: (k) => clearInsightFlag(db, k),
    insightFlags: () => listInsightFlags(db),
    exportData: () => exportData(db),
    restoreData: (d) => restoreData(db, d),
  };
}

export function webStore(): Store {
  let data = emptyData();
  return {
    importStatement: (s, l, src) => web.importStatement(data, s, l, src),
    setCategory: (id, k, all) => web.setCategory(data, id, k, all),
    assignMerchant: (m, k) => web.assignMerchant(data, m, k),
    keepMerchantAsOther: (m) => web.keepMerchantAsOther(data, m),
    undoMerchant: (m) => web.undoMerchant(data, m),
    setBudget: (k, a) => web.setBudget(data, k, a),
    addCategory: (n, c) => web.addCategory(data, n, c),
    categories: () => web.categoriesOf(data),
    unknownMerchants: (m) => web.unknownMerchants(data, m),
    monthTransactions: (m, c) => web.monthTransactions(data, m, c),
    allTransactions: () => web.allTransactions(data),
    listMonths: () => web.listMonths(data),
    monthSummary: (m, c) => web.monthSummary(data, m, c),
    cards: () => web.listCards(data),
    lastUpdate: () => web.lastUpdate(data),
    budgets: () => web.listBudgets(data),
    setFlag: (id, k, c) => web.setFlag(data, id, k, c),
    resolveFlag: (id, r) => web.resolveFlag(data, id, r),
    clearFlag: (id) => web.clearFlag(data, id),
    flags: () => web.listFlags(data),
    setInsightFlag: (m, i, c) => web.setInsightFlag(data, m, i, c),
    resolveInsightFlag: (k, r) => web.resolveInsightFlag(data, k, r),
    clearInsightFlag: (k) => web.clearInsightFlag(data, k),
    insightFlags: () => web.listInsightFlags(data),
    exportData: () => structuredClone(data),
    restoreData: (d) => { data = structuredClone(d); },
  };
}

export const stores: Array<[string, () => Store]> = [['sqlite', sqliteStore], ['web', webStore]];

export const tx = (over: Partial<ParsedTransaction>): ParsedTransaction => ({
  id: 'isracard:1234:1', company: 'isracard', cardLast4: '1234', purchaseDate: '2026-10-01', chargeDate: '2026-10-02',
  rawMerchant: 'x', merchant: 'שופרסל דיל', originalAmount: 10, originalCurrency: 'ILS',
  chargedAmount: 10, chargedCurrency: 'ILS', voucher: '1', standingOrder: false, foreignSite: false,
  discount: 0, details: '', source: 'excel', ...over,
});

export const stmt = (transactions: ParsedTransaction[]): ParsedStatement => ({
  company: 'isracard', cardName: 'x', cardLast4: '1234', month: '2026-10', chargeDate: null, statedTotal: null, transactions,
});
