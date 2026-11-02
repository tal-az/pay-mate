import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { parseIsracardFile, parseIsracardWorkbook } from '../electron/sources/excel/isracard';

/** Builds a synthetic workbook that mimics the layout of a real Isracard export. */
function buildWorkbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('פירוט עסקאות');
  ws.getCell('A2').value = 'פירוט עסקאות';
  ws.getCell('C2').value = 'אוקטובר 2026';
  ws.getCell('A5').value = '\u202bגולד - מסטרקארד\u202c - 1234';
  ws.getCell('H5').value = '₪ 300.00';
  ws.getCell('A6').value = 'על שם ישראל ישראלי';
  ws.getCell('H6').value = 'לחיוב ב-02.10';
  ws.getCell('A9').value = 'עסקאות למועד חיוב';
  ws.getRow(10).values = [
    'תאריך רכישה', 'שם בית עסק', 'סכום עסקה', 'מטבע עסקה',
    'סכום חיוב', 'מטבע חיוב', "מס' שובר", 'פירוט נוסף',
  ];
  ws.getRow(11).values = ['01.10.26', 'קפה לדוגמה   ', 40, '₪', 40, '₪', '111', ''];
  ws.getRow(12).values = ['29.09.26', 'APPLE.COM/BILL           ', 11.9, '₪', 11.9, '₪', '222', 'אתר חו"ל\nהוראת קבע'];
  ws.getRow(13).values = ['23.09.26', 'ביטוח לדוגמה', 131, '₪', 124.45, '₪', '333', 'הנחה ₪6.55 \nהוראת קבע'];
  ws.getRow(14).values = ['02.09.26', 'AWS EMEA                 ', 0.67, '$', 2.06, '₪', '444', 'אתר חו"ל'];
  ws.getRow(15).values = [null, 'סה"כ לחיוב החודש בכרטיס בש"ח', null, null, 178.41, '₪'];
  ws.getCell('A18').value = 'עסקאות בחיוב עתידי';
  ws.getCell('A19').value = 'ביצעת 1 עסקאות בסך ₪2.07 שיחיובו בחודש נובמבר';
  return wb;
}

describe('parseIsracardWorkbook', () => {
  const stmt = parseIsracardWorkbook(buildWorkbook());

  it('reads the statement header', () => {
    expect(stmt.cardLast4).toBe('1234');
    expect(stmt.cardName).toBe('גולד - מסטרקארד');
    expect(stmt.month).toBe('2026-10');
    expect(stmt.chargeDate).toBe('2026-10-02');
    expect(stmt.statedTotal).toBe(178.41);
  });

  it('ignores summary and legal rows below the total', () => {
    expect(stmt.transactions).toHaveLength(4);
  });

  it('matches the stated total (checksum)', () => {
    const sum = stmt.transactions.reduce((s, t) => s + t.chargedAmount, 0);
    expect(sum).toBeCloseTo(stmt.statedTotal!, 2);
  });

  it('cleans merchant names and converts dates', () => {
    const [cafe, apple] = stmt.transactions;
    expect(cafe.merchant).toBe('קפה לדוגמה');
    expect(cafe.purchaseDate).toBe('2026-10-01');
    expect(apple.merchant).toBe('APPLE.COM/BILL');
  });

  it('flags standing orders, foreign sites and discounts', () => {
    const [, apple, insurance, aws] = stmt.transactions;
    expect(apple.standingOrder).toBe(true);
    expect(apple.foreignSite).toBe(true);
    expect(insurance.discount).toBeCloseTo(6.55);
    expect(insurance.chargedAmount).toBe(124.45);
    expect(aws.originalCurrency).toBe('USD');
    expect(aws.chargedCurrency).toBe('ILS');
  });

  it('uses the voucher number as a stable id', () => {
    expect(stmt.transactions[0].id).toBe('isracard:1234:111');
    const again = parseIsracardWorkbook(buildWorkbook());
    expect(again.transactions.map((t) => t.id)).toEqual(stmt.transactions.map((t) => t.id));
  });

  it('rejects files that are not an Isracard statement', () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('x').getCell('A1').value = 'hello';
    expect(() => parseIsracardWorkbook(wb)).toThrow();
  });
});

// Optional: run against a real export without committing it. Set PAYMATE_REAL_XLSX to its path.
const realFile = process.env.PAYMATE_REAL_XLSX;
describe.skipIf(!realFile || !existsSync(realFile))('real Isracard export', () => {
  it('imports and matches the stated total', async () => {
    const stmt = await parseIsracardFile(realFile!);
    const sum = stmt.transactions.reduce((s, t) => s + t.chargedAmount, 0);
    expect(stmt.transactions.length).toBeGreaterThan(0);
    expect(sum).toBeCloseTo(stmt.statedTotal!, 1);
  });
});
