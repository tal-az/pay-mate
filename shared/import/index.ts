import type { ParsedStatement } from '../types';
import { loadWorkbook } from './excel';
import { isIsracardWorkbook, parseIsracardWorkbook } from './isracard';
import { isMaxWorkbook, parseMaxWorkbook } from './max';

/** Parses an .xlsx export from any supported card company, telling them apart by their header row. */
export async function parseStatementBuffer(data: ArrayBuffer | Uint8Array): Promise<ParsedStatement> {
  const wb = await loadWorkbook(data);
  if (isIsracardWorkbook(wb)) return parseIsracardWorkbook(wb);
  if (isMaxWorkbook(wb)) return parseMaxWorkbook(wb);
  throw new Error('הקובץ לא נראה כמו פירוט עסקאות של ישראכארט או של מקס');
}
