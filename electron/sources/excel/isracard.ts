import { posix } from 'node:path';
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { cleanText, currencyCode, fallbackId, normalizeMerchant } from '../../core/normalize';
import type { ParsedStatement, ParsedTransaction } from '../../../shared/types';

const HEADER_MARKER = 'תאריך רכישה';
const TOTAL_MARKER = 'סה"כ לחיוב';

function cellText(cell: ExcelJS.CellValue | undefined): string {
  if (cell == null) return '';
  if (typeof cell === 'object' && 'richText' in cell) {
    return cell.richText.map((r) => r.text).join('');
  }
  if (typeof cell === 'object' && 'result' in cell) return String(cell.result ?? '');
  return String(cell);
}

function cellNumber(cell: ExcelJS.CellValue | undefined): number {
  if (typeof cell === 'number') return cell;
  const n = Number(cleanText(cellText(cell)).replace(/[₪$€£,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Accepts dd.mm.yy, dd.mm.yyyy, dd/mm/yy or a real Date. */
function toIsoDate(cell: ExcelJS.CellValue | undefined): string | null {
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  const m = cleanText(cellText(cell)).match(/^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})$/);
  if (!m) return null;
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

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

/**
 * Isracard's export is written by a library that (1) uses absolute relationship targets
 * ("/xl/workbook.xml") and (2) prefixes every spreadsheet element with "x:". exceljs
 * handles neither, so rewrite the package into the conventional shape first.
 */
async function normalizePackage(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  for (const name of Object.keys(zip.files)) {
    const isRels = name.endsWith('.rels');
    if (!isRels && !name.endsWith('.xml')) continue;
    let xml = (await zip.files[name].async('string')).replace(/^﻿/, '');
    if (isRels) {
      const baseDir = posix.dirname(posix.dirname(name)); // "<dir>/_rels/x.rels" -> "<dir>"
      xml = xml.replace(/Target="\/([^"]+)"/g, (_m, target: string) => {
        return `Target="${posix.relative(baseDir === '.' ? '/' : '/' + baseDir, '/' + target)}"`;
      });
    } else if (xml.includes('xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"')) {
      xml = xml
        .replace('xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
                 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"')
        .replace(/<(\/?)x:/g, '<$1');
    }
    zip.file(name, xml);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

export async function parseIsracardFile(path: string): Promise<ParsedStatement> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await normalizePackage(await readFile(path))) as unknown as ArrayBuffer);
  return parseIsracardWorkbook(wb);
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
