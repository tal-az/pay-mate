import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { mapAccount, failureFromErrorType, failureMessage } from '../electron/sources/sync/map';
import { parseIsracardWorkbook } from '../shared/import/isracard';
import { openDb, importStatement } from '../electron/db/db';

const account = {
  accountNumber: '1958',
  txns: [
    {
      identifier: 95817883, date: '2026-09-09T00:00:00.000Z', processedDate: '2026-10-02T00:00:00.000Z',
      originalAmount: -39.9, originalCurrency: 'ILS', chargedAmount: -39.9, chargedCurrency: 'ILS',
      description: 'APPLE.COM/BILL           ', memo: 'אתר חו"ל\nהוראת קבע',
    },
    {
      identifier: 45845256, date: '2026-09-02T00:00:00.000Z', processedDate: '2026-10-02T00:00:00.000Z',
      originalAmount: -0.67, originalCurrency: '$', chargedAmount: -2.06, chargedCurrency: '₪',
      description: 'AWS EMEA', memo: 'אתר חו"ל',
    },
    {
      identifier: 77, date: '2026-09-20T00:00:00.000Z', processedDate: '2026-10-02T00:00:00.000Z',
      originalAmount: 25, originalCurrency: 'ILS', chargedAmount: 25, chargedCurrency: 'ILS', description: 'זיכוי', memo: '',
    },
  ],
};

describe('mapAccount', () => {
  const stmt = mapAccount(account, 'isracard');

  it('turns spending into positive amounts and refunds into negative ones', () => {
    expect(stmt.transactions.map((t) => t.chargedAmount)).toEqual([39.9, 2.06, -25]);
  });

  it('reads dates, currencies and flags', () => {
    const [apple, aws] = stmt.transactions;
    expect(apple.purchaseDate).toBe('2026-09-09');
    expect(apple.chargeDate).toBe('2026-10-02');
    expect(apple.merchant).toBe('APPLE.COM/BILL');
    expect(apple.standingOrder).toBe(true);
    expect(apple.foreignSite).toBe(true);
    expect(aws.originalCurrency).toBe('USD');
    expect(aws.chargedCurrency).toBe('ILS');
    expect(stmt.cardLast4).toBe('1958');
    expect(stmt.transactions.every((t) => t.source === 'sync')).toBe(true);
  });

  it('produces the same id as the Excel importer, so the two sources never duplicate each other', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('פירוט עסקאות');
    ws.getCell('C2').value = 'אוקטובר 2026';
    ws.getCell('A5').value = 'גולד - מסטרקארד - 1958';
    ws.getRow(10).values = ['תאריך רכישה', 'שם בית עסק', 'סכום עסקה', 'מטבע עסקה', 'סכום חיוב', 'מטבע חיוב', "מס' שובר", 'פירוט נוסף'];
    ws.getRow(11).values = ['09.09.26', 'APPLE.COM/BILL', 39.9, '₪', 39.9, '₪', '095817883', 'אתר חו"ל\nהוראת קבע'];
    const excel = parseIsracardWorkbook(wb);
    expect(excel.transactions[0].id).toBe(stmt.transactions[0].id);

    const db = openDb(':memory:', join(__dirname, '../electron/db'));
    expect(importStatement(db, excel, 'f.xlsx', 'excel').added).toBe(1);
    expect(importStatement(db, mapAccount({ accountNumber: '1958', txns: [account.txns[0]] }, 'isracard'), 'sync', 'sync')).toEqual({ added: 0, skipped: 1 });
  });
});

describe('other card companies', () => {
  const txn = {
    identifier: 'A1', date: '2026-09-09T00:00:00.000Z', processedDate: '2026-10-02T00:00:00.000Z',
    originalAmount: -100, originalCurrency: 'ILS', chargedAmount: -100, description: 'חנות', memo: '',
  };

  it('keeps each company in its own ids', () => {
    const max = mapAccount({ accountNumber: '1958', txns: [txn] }, 'max');
    expect(max.company).toBe('max');
    expect(max.transactions[0].company).toBe('max');
    expect(max.transactions[0].id).toBe('max:1958:A1');
    expect(mapAccount({ accountNumber: '1958', txns: [txn] }, 'visaCal').transactions[0].id).toBe('visaCal:1958:A1');
  });

  it('keeps Isracard ids unchanged, so data already imported still dedupes', () => {
    const t = { ...txn, identifier: '095817883', installmentNumber: 2 };
    expect(mapAccount({ accountNumber: '1958', txns: [t] }, 'isracard').transactions[0].id).toBe('isracard:1958:95817883');
  });

  it('skips pending charges, which have no stable identifier yet', () => {
    const pending = { ...txn, identifier: undefined, status: 'pending' };
    const done = { ...txn, status: 'completed' };
    expect(mapAccount({ accountNumber: '1958', txns: [pending, done] }, 'visaCal').transactions.map((t) => t.id)).toEqual(['visaCal:1958:A1']);
  });

  it('gives each payment of an installment deal its own id', () => {
    const txns = [{ ...txn, installmentNumber: 1 }, { ...txn, installmentNumber: 2 }];
    expect(mapAccount({ accountNumber: '1958', txns }, 'visaCal').transactions.map((t) => t.id)).toEqual(['visaCal:1958:A1:1', 'visaCal:1958:A1:2']);
  });

  it('treats a refund as a refund when the charge has the opposite sign', () => {
    const refund = { ...txn, originalAmount: 40, chargedAmount: -40 };
    expect(mapAccount({ accountNumber: '1958', txns: [refund] }, 'visaCal').transactions[0].chargedAmount).toBe(-40);
  });
});

describe('failureMessage', () => {
  it('names the fields and the site of the chosen company', () => {
    expect(failureMessage('credentials', 'max')).toContain('שם משתמש');
    expect(failureMessage('credentials', 'max')).not.toContain('תעודת זהות');
    expect(failureMessage('credentials', 'isracard')).toContain('6 ספרות אחרונות');
    expect(failureMessage('blocked', 'visaCal')).toContain('כאל');
    expect(failureMessage('password-change', 'amex')).toContain('אמריקן אקספרס');
  });

  it('still reads properly without a company', () => {
    expect(failureMessage('unknown')).toBe('הסנכרון נכשל. אפשר לייבא קובץ Excel בינתיים.');
    expect(failureMessage('blocked')).toContain('חברת האשראי');
  });
});

describe('failureFromErrorType', () => {
  it('maps scraper errors to user-facing failures', () => {
    expect(failureFromErrorType('INVALID_PASSWORD')).toBe('credentials');
    expect(failureFromErrorType('CHANGE_PASSWORD')).toBe('password-change');
    expect(failureFromErrorType('ACCOUNT_BLOCKED')).toBe('blocked');
    expect(failureFromErrorType('TIMEOUT')).toBe('timeout');
    expect(failureFromErrorType('GENERIC')).toBe('site-changed');
    expect(failureFromErrorType(undefined)).toBe('unknown');
  });
});
