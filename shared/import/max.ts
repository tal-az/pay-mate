import type ExcelJS from 'exceljs';
import { cellNumber, cellText, loadWorkbook, toIsoDate } from './excel';
import { cleanText, currencyCode, fallbackId, normalizeMerchant } from '../core/normalize';
import type { ParsedStatement, ParsedTransaction } from '../types';

/** Header texts of Max's "transaction details" export. Columns are found by name, not position. */
const COL = {
  date: 'תאריך עסקה',
  merchant: 'שם בית העסק',
  last4: '4 ספרות אחרונות של כרטיס האשראי',
  type: 'סוג עסקה',
  charged: 'סכום חיוב',
  chargedCurrency: 'מטבע חיוב',
  original: 'סכום עסקה מקורי',
  originalCurrency: 'מטבע עסקה מקורי',
  chargeDate: 'תאריך חיוב',
  notes: 'הערות',
} as const;
type ColKey = keyof typeof COL;

const TOTAL_MARKER = 'סך הכל';
/** Approved charges the card company has not processed yet. Their amounts are not final and they show up again once they are. */
const PENDING_SHEET = 'טרם נקלטו';

interface Header {
  row: number;
  cols: Record<ColKey, number>;
}

function findHeader(ws: ExcelJS.Worksheet): Header | null {
  for (let r = 1; r <= Math.min(ws.rowCount, 40); r++) {
    const row = ws.getRow(r);
    const found: Partial<Record<ColKey, number>> = {};
    for (let c = 1; c <= Math.max(row.cellCount, 20); c++) {
      const text = cleanText(cellText(row.getCell(c).value));
      const key = (Object.keys(COL) as ColKey[]).find((k) => COL[k] === text);
      if (key && !found[key]) found[key] = c;
    }
    if (found.date && found.merchant && found.charged) {
      const cols = Object.fromEntries((Object.keys(COL) as ColKey[]).map((k) => [k, found[k] ?? 0])) as Record<ColKey, number>;
      return { row: r, cols };
    }
  }
  return null;
}

export function isMaxWorkbook(wb: ExcelJS.Workbook): boolean {
  return wb.worksheets.some((ws) => findHeader(ws) != null);
}

/** Parses the bytes of a Max .xlsx export. Runs in Node and in a browser. */
export async function parseMaxBuffer(data: ArrayBuffer | Uint8Array): Promise<ParsedStatement> {
  return parseMaxWorkbook(await loadWorkbook(data));
}

export function parseMaxWorkbook(wb: ExcelJS.Workbook): ParsedStatement {
  const sheets = wb.worksheets
    .map((ws) => ({ ws, header: findHeader(ws) }))
    .filter((s): s is { ws: ExcelJS.Worksheet; header: Header } => s.header != null);
  if (sheets.length === 0) throw new Error('הקובץ לא נראה כמו פירוט עסקאות של מקס');

  let month: string | null = null;
  let statedTotal: number | null = null;
  const transactions: ParsedTransaction[] = [];
  const seen = new Map<string, number>();

  for (const { ws, header } of sheets) {
    if (ws.name.includes(PENDING_SHEET)) continue;
    const { cols } = header;
    const get = (row: ExcelJS.Row, key: ColKey) => (cols[key] ? row.getCell(cols[key]).value : undefined);

    // Above the header: user and card filters, then the billing month as "12/2026".
    for (let r = 1; r < header.row && !month; r++) {
      const row = ws.getRow(r);
      for (let c = 1; c <= 5 && !month; c++) {
        const m = cleanText(cellText(row.getCell(c).value)).match(/^(\d{1,2})\/(\d{4})$/);
        if (m) month = `${m[2]}-${m[1].padStart(2, '0')}`;
      }
    }

    for (let r = header.row + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const first = cleanText(cellText(get(row, 'date')));
      if (first === TOTAL_MARKER) {
        // The total sits in the next non-empty row of the same column.
        for (let t = r + 1; t <= ws.rowCount; t++) {
          const v = get(ws.getRow(t), 'date');
          if (cleanText(cellText(v))) {
            statedTotal = (statedTotal ?? 0) + cellNumber(v);
            break;
          }
        }
        break;
      }
      const purchaseDate = toIsoDate(get(row, 'date'));
      if (!purchaseDate) continue;
      const chargedCell = get(row, 'charged');
      if (chargedCell == null || cleanText(cellText(chargedCell)) === '') continue; // not charged yet

      const cardLast4 = cleanText(cellText(get(row, 'last4')));
      const rawMerchant = cleanText(cellText(get(row, 'merchant')));
      const merchant = normalizeMerchant(rawMerchant);
      const chargedAmount = cellNumber(chargedCell);
      const originalCell = get(row, 'original');
      const originalAmount = cleanText(cellText(originalCell)) ? cellNumber(originalCell) : chargedAmount;
      const chargedCurrency = currencyCode(cellText(get(row, 'chargedCurrency')) || '₪');
      const originalCurrency = currencyCode(cellText(get(row, 'originalCurrency')) || cellText(get(row, 'chargedCurrency')) || '₪');
      const type = cleanText(cellText(get(row, 'type')));
      const notes = cleanText(cellText(get(row, 'notes')));
      const details = [type === 'רגילה' ? '' : type, notes].filter(Boolean).join(' · ');
      const installment = `${type} ${notes}`.match(/תשלום\s*(\d+)\s*מתוך\s*\d+/);
      const discountMatch = notes.match(/הנחה\s*₪?\s*([\d.,]+)/);

      // The export has no voucher numbers, so the id comes from the charge itself. It matches the sync id of a
      // charge the scraper gave no identifier. Payments of one deal differ by installment; identical charges on
      // the same day differ by the order they appear in.
      const base = `max:${cardLast4}:${fallbackId([purchaseDate, merchant, originalAmount, chargedAmount])}${installment ? `:${installment[1]}` : ''}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);

      transactions.push({
        id: n === 1 ? base : `${base}#${n}`,
        company: 'max',
        cardLast4,
        purchaseDate,
        chargeDate: toIsoDate(get(row, 'chargeDate')),
        rawMerchant,
        merchant,
        originalAmount,
        originalCurrency,
        chargedAmount,
        chargedCurrency,
        voucher: null,
        standingOrder: details.includes('הוראת קבע'),
        foreignSite: details.includes('חו"ל') || originalCurrency !== 'ILS',
        discount: discountMatch ? Number(discountMatch[1].replace(/,/g, '')) : 0,
        details,
        source: 'excel',
      });
    }
  }

  const cards = [...new Set(transactions.map((t) => t.cardLast4).filter(Boolean))];
  const chargeDates = transactions.map((t) => t.chargeDate).filter((d): d is string => !!d);
  const chargeDate = mostCommon(chargeDates);

  return {
    company: 'max',
    cardName: '',
    cardLast4: cards.join(', '),
    month: month ?? chargeDate?.slice(0, 7) ?? null,
    chargeDate,
    statedTotal,
    transactions,
  };
}

function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  for (const [v, n] of counts) if (best == null || n > counts.get(best)!) best = v;
  return best;
}
