import { cleanText, currencyCode, fallbackId, normalizeMerchant } from '../../core/normalize';
import type { ParsedStatement, ParsedTransaction } from '../../../shared/types';
import type { SyncFailure } from '../../../shared/api';
import { findProvider, type ProviderKey } from '../../../shared/providers';

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
  status?: string;
  installmentNumber?: number;
}

export interface ScrapedAccount {
  accountNumber: string;
  txns: ScrapedTransaction[];
}

const isoDay = (iso: string) => iso.slice(0, 10);

/**
 * The scraper reports spending as negative numbers; the app stores spending as positive.
 * Voucher numbers come back as integers, so ids strip leading zeros to match Excel imports.
 * Pending charges are skipped: they have no stable identifier yet and would appear twice once they complete.
 * Outside Isracard the installment number is part of the id, since a deal's payments can share one identifier.
 */
export function mapAccount(account: ScrapedAccount, company: ProviderKey): ParsedStatement {
  const cardLast4 = account.accountNumber.slice(-4);
  const transactions: ParsedTransaction[] = account.txns.filter((t) => t.status !== 'pending').map((t) => {
    const merchant = normalizeMerchant(t.description);
    const details = cleanText(t.memo);
    const voucher = t.identifier == null ? null : String(t.identifier).replace(/^0+(?=\d)/, '');
    const originalAmount = -t.originalAmount;
    // The Cal scraper can report a refund with a positive original amount and a negative charge. The original has the true sign.
    const signsDiffer = t.originalAmount * t.chargedAmount < 0;
    const chargedAmount = signsDiffer ? t.chargedAmount : -t.chargedAmount;
    const installment = company !== 'isracard' && t.installmentNumber ? `:${t.installmentNumber}` : '';
    const discountMatch = details.match(/הנחה\s*₪?\s*([\d.,]+)/);
    return {
      id: voucher
        ? `${company}:${cardLast4}:${voucher}${installment}`
        : `${company}:${cardLast4}:${fallbackId([isoDay(t.date), merchant, originalAmount, chargedAmount])}${installment}`,
      company,
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
  return { company, cardName: '', cardLast4, month: null, chargeDate: null, statedTotal: null, transactions };
}

export function mapAccounts(accounts: ScrapedAccount[], company: ProviderKey): ParsedStatement[] {
  return accounts.map((a) => mapAccount(a, company));
}

const siteOf = (company?: ProviderKey) => `אתר ${findProvider(company)?.name ?? 'חברת האשראי'}`;

const MESSAGES: Record<SyncFailure, string | ((company?: ProviderKey) => string)> = {
  credentials: (company) => {
    const labels = findProvider(company)?.fields.map((f) => f.label).join(', ');
    return labels ? `פרטי ההתחברות שגויים. בדקו: ${labels}.` : 'פרטי ההתחברות שגויים.';
  },
  blocked: (company) => `החשבון ב${siteOf(company)} חסום. יש לפנות לחברת האשראי.`,
  'password-change': (company) => `האתר מבקש להחליף סיסמה. היכנסו ל${siteOf(company)}, החליפו סיסמה ונסו שוב.`,
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

export function failureMessage(failure: SyncFailure, company?: ProviderKey): string {
  const message = MESSAGES[failure];
  return typeof message === 'function' ? message(company) : message;
}
