export type Source = 'excel' | 'sync';

export interface ParsedTransaction {
  /** Stable id used for dedupe across imports and sources. */
  id: string;
  company: string;
  cardLast4: string;
  purchaseDate: string; // YYYY-MM-DD
  chargeDate: string | null; // YYYY-MM-DD
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
  source: Source;
}

export interface ParsedStatement {
  company: string;
  cardName: string;
  cardLast4: string;
  /** Month the statement is titled with, e.g. 2026-10. */
  month: string | null;
  chargeDate: string | null;
  /** The "total to charge" row of the file, used as a checksum. */
  statedTotal: number | null;
  transactions: ParsedTransaction[];
}
