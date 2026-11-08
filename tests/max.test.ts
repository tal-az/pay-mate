import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { parseMaxWorkbook } from '../shared/import/max';
import { parseStatementBuffer } from '../shared/import';

const HEADER = [
  null, 'תאריך עסקה', 'שם בית העסק', 'קטגוריה', '4 ספרות אחרונות של כרטיס האשראי', 'סוג עסקה', 'סכום חיוב', 'מטבע חיוב',
  'סכום עסקה מקורי', 'מטבע עסקה מקורי', 'תאריך חיוב', 'הערות', 'תיוגים', 'מועדון הנחות', 'מפתח דיסקונט',
  'אופן ביצוע ההעסקה', 'שער המרה ממטבע מקור/התחשבנות לש"ח',
];

function sheet(wb: ExcelJS.Workbook, name: string, rows: unknown[][], total: string) {
  const ws = wb.addWorksheet(name);
  ws.getCell('B1').value = 'כל המשתמשים (1)';
  ws.getCell('B2').value = 'כל הכרטיסים (2)';
  ws.getCell('B3').value = '12/2026';
  ws.getRow(4).values = HEADER;
  rows.forEach((r, i) => { ws.getRow(5 + i).values = [null, ...r]; });
  ws.getCell(`B${5 + rows.length + 1}`).value = 'סך הכל';
  ws.getCell(`B${5 + rows.length + 2}`).value = total;
}

/** Mimics the layout of a real Max "transaction details" export. */
function buildWorkbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  sheet(wb, 'עסקאות במועד החיוב', [
    ['02-11-2026', 'עיריית לדוגמה-ארנונה', 'עירייה וממשלה', '4041', 'הוראת קבע', 1293.13, '₪', 1293.13, '₪', '02-12-2026', null, null, null, null, 'אינטרנט'],
    ['10-11-2026', 'קפה לדוגמה', 'מזון וצריכה', '4041', 'רגילה', 18, '₪', 18, '₪', '02-12-2026'],
    ['10-11-2026', 'קפה לדוגמה', 'מזון וצריכה', '4041', 'רגילה', 18, '₪', 18, '₪', '02-12-2026'],
    ['15-09-2026', 'חנות רהיטים', 'ריהוט ובית', '9876', 'תשלומים', 200, '₪', 600, '₪', '02-12-2026', 'תשלום 3 מתוך 3'],
    ['20-11-2026', 'AMAZON MKTPLACE', 'שונות', '9876', 'רגילה', 37.5, '₪', 10, '$', '02-12-2026'],
    ['21-11-2026', 'זיכוי לדוגמה', 'שונות', '4041', 'זיכוי', -50, '₪', -50, '₪', '02-12-2026'],
  ], '1516.63₪');
  sheet(wb, 'עסקאות שאושרו וטרם נקלטו', [
    ['06-11-2026', 'שווארמה לדוגמה', 'מזון וצריכה', '4041', 'רגילה', null, null, 190, '₪'],
  ], '0');
  return wb;
}

describe('parseMaxWorkbook', () => {
  const stmt = parseMaxWorkbook(buildWorkbook());

  it('reads the statement header', () => {
    expect(stmt.company).toBe('max');
    expect(stmt.month).toBe('2026-12');
    expect(stmt.chargeDate).toBe('2026-12-02');
    expect(stmt.cardLast4).toBe('4041, 9876');
    expect(stmt.statedTotal).toBe(1516.63);
  });

  it('skips charges that were approved but not processed yet', () => {
    expect(stmt.transactions).toHaveLength(6);
    expect(stmt.transactions.some((t) => t.merchant === 'שווארמה לדוגמה')).toBe(false);
  });

  it('matches the stated total (checksum)', () => {
    const sum = stmt.transactions.reduce((s, t) => s + t.chargedAmount, 0);
    expect(sum).toBeCloseTo(stmt.statedTotal!, 2);
  });

  it('maps the fields of each charge', () => {
    const [tax, , , sofa, amazon, refund] = stmt.transactions;
    expect(tax).toMatchObject({
      company: 'max', cardLast4: '4041', purchaseDate: '2026-11-02', chargeDate: '2026-12-02', chargedAmount: 1293.13,
      chargedCurrency: 'ILS', standingOrder: true, foreignSite: false, source: 'excel', voucher: null,
    });
    expect(sofa).toMatchObject({ cardLast4: '9876', originalAmount: 600, chargedAmount: 200, details: 'תשלומים · תשלום 3 מתוך 3' });
    expect(amazon).toMatchObject({ originalAmount: 10, originalCurrency: 'USD', chargedAmount: 37.5, foreignSite: true });
    expect(refund.chargedAmount).toBe(-50);
  });

  it('gives every charge a distinct, stable id', () => {
    const ids = stmt.transactions.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith('max:'))).toBe(true);
    expect(ids[3]).toMatch(/^max:9876:[0-9a-f]{20}:3$/);
    expect(parseMaxWorkbook(buildWorkbook()).transactions.map((t) => t.id)).toEqual(ids);
  });

  it('rejects a workbook that is not a Max export', () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('x').getCell('A1').value = 'שלום';
    expect(() => parseMaxWorkbook(wb)).toThrow('מקס');
  });
});

describe('parseStatementBuffer', () => {
  it('recognizes a Max export from its bytes', async () => {
    const buffer = await buildWorkbook().xlsx.writeBuffer();
    const stmt = await parseStatementBuffer(new Uint8Array(buffer as ArrayBuffer));
    expect(stmt.company).toBe('max');
    expect(stmt.transactions).toHaveLength(6);
  });

  it('rejects other spreadsheets', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('x').getCell('A1').value = 'שלום';
    const buffer = await wb.xlsx.writeBuffer();
    await expect(parseStatementBuffer(new Uint8Array(buffer as ArrayBuffer))).rejects.toThrow('ישראכארט או של מקס');
  });
});
