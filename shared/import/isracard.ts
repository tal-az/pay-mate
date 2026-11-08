import type ExcelJS from 'exceljs';
import { cellNumber, cellText, loadWorkbook, toIsoDate } from './excel';
import { cleanText, currencyCode, fallbackId, normalizeMerchant } from '../core/normalize';
import type { ParsedStatement, ParsedTransaction } from '../types';

const HEADER_MARKER = 'תאריך רכישה';
const TOTAL_MARKER = 'סה"כ לחיוב';

const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

function parseMonthTitle(text: string): { month: string; year: number } | null {
  const m = cleanText(text).match(/(\S+)\s+(\d{4})/);
  if (!m) return null;
  const idx = HEBREW_MONTHS.indexOf(m[1]);
  if (idx < 0) return null;
  return { month: `${m[2]}-${String(idx + 1).padStart(2, '0')}`, year: Number(m[2]) };
}

export function isIsracardWorkbook(wb: ExcelJS.Workbook): boolean {
  return findHeaderRow(wb.worksheets[0]) > 0;
}

function findHeaderRow(ws: ExcelJS.Worksheet | undefined): number {
  if (!ws) return 0;
  for (let r = 1; r <= Math.min(ws.rowCount, 40); r++) {
    if (cleanText(cellText(ws.getRow(r).getCell(1).value)) === HEADER_MARKER) return r;
  }
  return 0;
}

/** Parses the bytes of an Isracard .xlsx export. Runs in Node and in a browser. */
export async function parseIsracardBuffer(data: ArrayBuffer | Uint8Array): Promise<ParsedStatement> {
  return parseIsracardWorkbook(await loadWorkbook(data));
}

export function parseIsracardWorkbook(wb: ExcelJS.Workbook): ParsedStatement {
  const ws = wb.worksheets[0];
  const headerRow = findHeaderRow(ws);
  if (!headerRow) throw new Error('הקובץ לא נראה כמו פירוט עסקאות של ישראכארט');

  // Everything above the header: month title, card line, billing date.
  let monthInfo: { month: string; year: number } | null = null;
  let cardName = '';
  let cardLast4 = '';
  let chargeDate: string | null = null;
  for (let r = 1; r < headerRow; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= 8; c++) {
      const text = cleanText(cellText(row.getCell(c).value));
      if (!text) continue;
      if (!monthInfo) monthInfo = parseMonthTitle(text);
      const card = text.match(/^(.+?)\s*-\s*(\d{4})$/);
      if (card && !cardLast4) {
        cardName = card[1].trim();
        cardLast4 = card[2];
      }
      const bill = text.match(/לחיוב ב-?\s*(\d{1,2})\.(\d{1,2})/);
      if (bill && monthInfo) {
        chargeDate = `${monthInfo.year}-${bill[2].padStart(2, '0')}-${bill[1].padStart(2, '0')}`;
      }
    }
  }

  const transactions: ParsedTransaction[] = [];
  let statedTotal: number | null = null;

  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const first = cleanText(cellText(row.getCell(1).value));
    const second = cleanText(cellText(row.getCell(2).value));

    if (second.startsWith(TOTAL_MARKER)) {
      statedTotal = cellNumber(row.getCell(5).value);
      break;
    }
    const purchaseDate = toIsoDate(row.getCell(1).value);
    if (!purchaseDate) {
      if (first || second) continue; // section titles and notes
      continue;
    }

    const rawMerchant = cellText(row.getCell(2).value);
    const details = cleanText(cellText(row.getCell(8).value));
    const voucher = cleanText(cellText(row.getCell(7).value)) || null;
    const originalAmount = cellNumber(row.getCell(3).value);
    const chargedAmount = cellNumber(row.getCell(5).value);
    const discountMatch = details.match(/הנחה\s*₪?\s*([\d.,]+)/);

    const merchant = normalizeMerchant(rawMerchant);
    const id = voucher
      ? `isracard:${cardLast4}:${voucher.replace(/^0+(?=\d)/, '')}`
      : `isracard:${cardLast4}:${fallbackId([purchaseDate, merchant, originalAmount, chargedAmount])}`;

    transactions.push({
      id,
      company: 'isracard',
      cardLast4,
      purchaseDate,
      chargeDate,
      rawMerchant: cleanText(rawMerchant),
      merchant,
      originalAmount,
      originalCurrency: currencyCode(cellText(row.getCell(4).value)),
      chargedAmount,
      chargedCurrency: currencyCode(cellText(row.getCell(6).value)),
      voucher,
      standingOrder: details.includes('הוראת קבע'),
      foreignSite: details.includes('חו"ל'),
      discount: discountMatch ? Number(discountMatch[1].replace(/,/g, '')) : 0,
      details,
      source: 'excel',
    });
  }

  return {
    company: 'isracard',
    cardName,
    cardLast4,
    month: monthInfo?.month ?? null,
    chargeDate,
    statedTotal,
    transactions,
  };
}
