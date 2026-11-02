import { cleanText, currencyCode, fallbackId, normalizeMerchant } from '../../core/normalize';
import type { ParsedStatement, ParsedTransaction } from '../../../shared/types';
import type { SyncFailure } from '../../../shared/api';

/** The parts of israeli-bank-scrapers' output that we read. Kept structural so this file has no runtime dependency on it. */
export interface ScrapedTransaction {
  identifier?: string | number;
  date: string;
  processedDate: string;
  originalAmount: number;
  originalCurrency: string;
  chargedAmount: number;
  chargedCurrency?: string;
  description: string;
  memo?: string;
}

export interface ScrapedAccount {
  accountNumber: string;
  txns: ScrapedTransaction[];
}

const isoDay = (iso: string) => iso.slice(0, 10);

/**
 * The scraper reports spending as negative numbers; the app stores spending as positive.
 * Voucher numbers come back as integers, so ids strip leading zeros to match Excel imports.
 */
export function mapAccount(account: ScrapedAccount): ParsedStatement {
  const cardLast4 = account.accountNumber.slice(-4);
  const transactions: ParsedTransaction[] = account.txns.map((t) => {
    const merchant = normalizeMerchant(t.description);
    const details = cleanText(t.memo);
    const voucher = t.identifier == null ? null : String(t.identifier).replace(/^0+(?=\d)/, '');
    const originalAmount = -t.originalAmount;
    const chargedAmount = -t.chargedAmount;
    const discountMatch = details.match(/הנחה\s*₪?\s*([\d.,]+)/);
    return {
      id: voucher
        ? `isracard:${cardLast4}:${voucher}`
        : `isracard:${cardLast4}:${fallbackId([isoDay(t.date), merchant, originalAmount, chargedAmount])}`,
      company: 'isracard',
      cardLast4,
      purchaseDate: isoDay(t.date),
      chargeDate: t.processedDate ? isoDay(t.processedDate) : null,
      rawMerchant: cleanText(t.description),
      merchant,
      originalAmount,
      originalCurrency: currencyCode(t.originalCurrency),
      chargedAmount,
      chargedCurrency: currencyCode(t.chargedCurrency ?? 'ILS'),
      voucher,
      standingOrder: details.includes('הוראת קבע'),
      foreignSite: details.includes('חו"ל'),
      discount: discountMatch ? Number(discountMatch[1].replace(/,/g, '')) : 0,
      details,
      source: 'sync',
    };
  });
  return { company: 'isracard', cardName: '', cardLast4, month: null, chargeDate: null, statedTotal: null, transactions };
}

export function mapAccounts(accounts: ScrapedAccount[]): ParsedStatement[] {
  return accounts.map(mapAccount);
}

const MESSAGES: Record<SyncFailure, string> = {
  credentials: 'פרטי ההתחברות שגויים. בדקו תעודת זהות, 6 ספרות אחרונות של הכרטיס וסיסמה.',
  blocked: 'החשבון באתר ישראכארט חסום. יש לפנות לחברת האשראי.',
  'password-change': 'האתר מבקש להחליף סיסמה. היכנסו לאתר ישראכארט, החליפו סיסמה ונסו שוב.',
  'site-changed': 'הסנכרון נכשל. ייתכן שהאתר השתנה. אפשר לייבא קובץ Excel בינתיים.',
  'no-browser': 'לא נמצא דפדפן Microsoft Edge או Chrome במחשב, והוא נדרש לסנכרון.',
  timeout: 'הסנכרון לקח יותר מדי זמן. נסו שוב, או ייבאו קובץ Excel.',
  unknown: 'הסנכרון נכשל. אפשר לייבא קובץ Excel בינתיים.',
};

export function failureFromErrorType(errorType: string | undefined): SyncFailure {
  switch (errorType) {
    case 'INVALID_PASSWORD': return 'credentials';
    case 'ACCOUNT_BLOCKED': return 'blocked';
    case 'CHANGE_PASSWORD': return 'password-change';
    case 'TIMEOUT': return 'timeout';
    case 'GENERIC':
    case 'GENERAL_ERROR': return 'site-changed';
    default: return 'unknown';
  }
}

export function failureMessage(failure: SyncFailure): string {
  return MESSAGES[failure];
}
