import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { cleanText } from '../core/normalize';

export function cellText(cell: ExcelJS.CellValue | undefined): string {
  if (cell == null) return '';
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  if (typeof cell === 'object' && 'richText' in cell) {
    return cell.richText.map((r) => r.text).join('');
  }
  if (typeof cell === 'object' && 'result' in cell) return String(cell.result ?? '');
  return String(cell);
}

export function cellNumber(cell: ExcelJS.CellValue | undefined): number {
  if (typeof cell === 'number') return cell;
  const n = Number(cleanText(cellText(cell)).replace(/[₪$€£,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Accepts dd.mm.yy, dd.mm.yyyy, dd/mm/yy, dd-mm-yyyy or a real Date. */
export function toIsoDate(cell: ExcelJS.CellValue | undefined): string | null {
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  const m = cleanText(cellText(cell)).match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
  if (!m) return null;
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** Directory of a zip entry name: "xl/_rels/x.rels" -> "xl/_rels", "x.xml" -> "". */
const dirOf = (name: string) => name.split('/').slice(0, -1).join('/');

/** Path from directory `from` to the file `to`, both zip paths without a leading slash. */
function relativePath(from: string, to: string): string {
  const a = from.split('/').filter(Boolean);
  const b = to.split('/').filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}

/**
 * Isracard's export is written by a library that (1) uses absolute relationship targets
 * ("/xl/workbook.xml") and (2) prefixes every spreadsheet element with "x:". exceljs
 * handles neither, so rewrite the package into the conventional shape first.
 * Conventional files (Max's export, for one) pass through unchanged in meaning.
 */
async function normalizePackage(buffer: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(buffer);
  for (const name of Object.keys(zip.files)) {
    const isRels = name.endsWith('.rels');
    if (!isRels && !name.endsWith('.xml')) continue;
    let xml = (await zip.files[name].async('string')).replace(/^﻿/, '');
    if (isRels) {
      const baseDir = dirOf(dirOf(name)); // "<dir>/_rels/x.rels" -> "<dir>"
      xml = xml.replace(/Target="\/([^"]+)"/g, (_m, target: string) => `Target="${relativePath(baseDir, target)}"`);
    } else if (xml.includes('xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"')) {
      xml = xml
        .replace('xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
                 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"')
        .replace(/<(\/?)x:/g, '<$1');
    }
    zip.file(name, xml);
  }
  return zip.generateAsync({ type: 'uint8array' });
}

/** Loads the bytes of an .xlsx file. Runs in Node and in a browser. */
export async function loadWorkbook(data: ArrayBuffer | Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await normalizePackage(data)) as unknown as ArrayBuffer);
  return wb;
}
