export interface Category {
  id: number;
  key: string;
  name: string;
  color: string;
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
  id: string;
  card6Digits: string;
  password: string;
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
  setCategory(txId: string, categoryKey: string, applyToMerchant: boolean): Promise<void>;
  insights(month: string): Promise<Insight[]>;
  budgets(): Promise<Budget[]>;
  setBudget(categoryKey: string, monthlyAmount: number | null): Promise<void>;
  pickFiles(): Promise<string[]>;
  importFiles(paths: string[]): Promise<ImportResult[]>;
  sync(request: SyncRequest): Promise<SyncResult>;
  onSyncProgress(callback: (message: string) => void): () => void;
  appVersion(): Promise<string>;
  checkForUpdates(): Promise<void>;
  installUpdate(): Promise<void>;
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
  pathForFile(file: File): string;
}

declare global {
  interface Window {
    paymate?: PayMateApi;
  }
}
