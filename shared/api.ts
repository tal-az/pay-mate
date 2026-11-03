import type { ProviderKey } from './providers';

export interface Category {
  id: number;
  key: string;
  name: string;
  color: string;
}

export const FLAG_KINDS = ['suspicious', 'mistake', 'attention'] as const;
export type FlagKind = (typeof FLAG_KINDS)[number];
export const MAX_FLAG_COMMENT = 500;

/** A note the user attached to a transaction; it stays an open task until resolved. */
export interface TxFlag {
  txId: string;
  kind: FlagKind;
  comment: string;
  resolved: boolean;
  createdAt: string;
  resolvedAt: string | null;
}

/** A flag together with the transaction it is about, for the tasks page. */
export interface FlaggedTx extends TxFlag {
  merchant: string;
  purchaseDate: string;
  chargedAmount: number;
  originalAmount: number;
  originalCurrency: string;
}

export interface TxRow {
  id: string;
  purchaseDate: string;
  chargeDate: string | null;
  merchant: string;
  categoryKey: string;
  chargedAmount: number;
  originalAmount: number;
  originalCurrency: string;
  standingOrder: boolean;
  foreignSite: boolean;
  discount: number;
  cardLast4: string;
  flag?: { kind: FlagKind; resolved: boolean; comment: string };
}

export interface CategoryTotal {
  key: string;
  name: string;
  color: string;
  amount: number;
  count: number;
}

export interface MerchantTotal {
  merchant: string;
  amount: number;
  count: number;
}

export interface MonthSummary {
  month: string;
  total: number;
  prevMonth: string | null;
  prevTotal: number | null;
  transactionCount: number;
  cards: string[];
  byCategory: CategoryTotal[];
  topMerchants: MerchantTotal[];
}

export interface Insight {
  id: string;
  kind: 'trend' | 'subscription' | 'unusual' | 'duplicate' | 'budget' | 'missing' | 'price' | 'commitments';
  attention: boolean;
  text: string;
  txIds: string[];
}

export interface MonthTotal {
  month: string;
  total: number;
}

export interface TimelineCell {
  month: string;
  /** Total charged that month, or null when the charge is missing. */
  amount: number | null;
  /** False when the card has no statement for that month, so nothing can be said about it. */
  covered: boolean;
}

export interface TimelineRow {
  merchant: string;
  card: string;
  usual: number;
  cells: TimelineCell[];
  holes: number;
}

export interface UnknownMerchant {
  merchant: string;
  count: number;
  total: number;
  firstDate: string;
  lastDate: string;
}

export interface Budget {
  categoryKey: string;
  monthlyAmount: number;
}

export interface ImportResult {
  file: string;
  ok: boolean;
  error?: string;
  month?: string | null;
  cardLast4?: string;
  added?: number;
  skipped?: number;
  totalMatches?: boolean | null;
}

export interface SyncRequest {
  company: ProviderKey;
  /** The login fields of the chosen company, by field name. */
  credentials: Record<string, string>;
  months: number;
}

export type SyncFailure = 'credentials' | 'blocked' | 'password-change' | 'site-changed' | 'no-browser' | 'timeout' | 'unknown';

export interface SyncResult {
  ok: boolean;
  failure?: SyncFailure;
  message?: string;
  added?: number;
  skipped?: number;
  cards?: string[];
}

export interface LastUpdate {
  /** ISO timestamp of the last successful sync or file import. */
  at: string;
  source: 'excel' | 'sync';
}

export type UpdateStatus =
  | { state: 'downloading'; version: string }
  | { state: 'ready'; version: string };

export interface RestoreResult {
  ok: boolean;
  /** A message for the user, in Hebrew, when ok is false. */
  error?: string;
  transactions?: number;
}

/** An Excel file chosen by the user, read in the renderer so both the desktop app and the website parse the same bytes. */
export interface ImportInput {
  name: string;
  data: ArrayBuffer;
}

/** What only the installed desktop app can do. The website has none of it, so the interface hides these features. */
export interface DesktopApi {
  sync(request: SyncRequest): Promise<SyncResult>;
  onSyncProgress(callback: (message: string) => void): () => void;
  appVersion(): Promise<string>;
  checkForUpdates(): Promise<void>;
  installUpdate(): Promise<void>;
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
}

export interface PayMateApi {
  months(): Promise<string[]>;
  lastUpdate(): Promise<LastUpdate | null>;
  unknownMerchants(month: string): Promise<UnknownMerchant[]>;
  /** Maps a business to a category in every month; "other" means leave it as other. */
  mapMerchant(merchant: string, categoryKey: string): Promise<void>;
  undoMapMerchant(merchant: string): Promise<void>;
  monthTotals(): Promise<MonthTotal[]>;
  recurringTimeline(): Promise<TimelineRow[]>;
  summary(month: string): Promise<MonthSummary>;
  transactions(month: string): Promise<TxRow[]>;
  categories(): Promise<Category[]>;
  /** Creates a category of the user's own. Rejects with a Hebrew message when the name is empty, too long or taken. */
  addCategory(name: string, color: string): Promise<Category>;
  setCategory(txId: string, categoryKey: string, applyToMerchant: boolean): Promise<void>;
  /** Flags a transaction, or edits its existing flag (keeping whether it is resolved). Rejects with a Hebrew message when the comment is too long. */
  setFlag(txId: string, kind: FlagKind, comment: string): Promise<void>;
  /** Closes a flag, or reopens it. */
  resolveFlag(txId: string, resolved: boolean): Promise<void>;
  clearFlag(txId: string): Promise<void>;
  /** Every flag in all months, newest first. */
  flags(): Promise<FlaggedTx[]>;
  insights(month: string): Promise<Insight[]>;
  budgets(): Promise<Budget[]>;
  setBudget(categoryKey: string, monthlyAmount: number | null): Promise<void>;
  importFiles(files: ImportInput[]): Promise<ImportResult[]>;
  /** The whole data set as the text of a backup file. */
  exportBackup(): Promise<string>;
  /** Replaces all data with a backup file's. When the file is not a valid backup nothing changes and the result says why. */
  restoreBackup(text: string): Promise<RestoreResult>;
  desktop?: DesktopApi;
}

declare global {
  interface Window {
    paymate?: PayMateApi;
  }
}
