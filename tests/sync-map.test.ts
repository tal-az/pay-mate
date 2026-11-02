import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { mapAccount, failureFromErrorType } from '../electron/sources/sync/map';
import { parseIsracardWorkbook } from '../electron/sources/excel/isracard';
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
  const stmt = mapAccount(account);

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
    expect(importStatement(db, mapAccount({ accountNumber: '1958', txns: [account.txns[0]] }), 'sync', 'sync')).toEqual({ added: 0, skipped: 1 });
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
