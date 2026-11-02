import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { openDb, importStatement } from '../electron/db/db';
import { listMonths, monthSummary } from '../electron/db/queries';
import { parseIsracardFile } from '../electron/sources/excel/isracard';

// Optional: runs the whole import path on a real export. Set PAYMATE_REAL_XLSX to its path.
const realFile = process.env.PAYMATE_REAL_XLSX;

describe.skipIf(!realFile || !existsSync(realFile))('real export, end to end', () => {
  it('imports, dedupes and summarizes', async () => {
    const db = openDb(':memory:', join(__dirname, '../electron/db'));
    const stmt = await parseIsracardFile(realFile!);
    const first = importStatement(db, stmt, 'real.xlsx', 'excel');
    const second = importStatement(db, stmt, 'real.xlsx', 'excel');
    expect(first.added).toBe(stmt.transactions.length);
    expect(second.added).toBe(0);

    const months = listMonths(db);
    expect(months).toHaveLength(1);
    const summary = monthSummary(db, months[0]);
    expect(summary.total).toBeCloseTo(stmt.statedTotal!, 1);

    const other = summary.byCategory.find((c) => c.key === 'other');
    const share = other ? other.count / summary.transactionCount : 0;
    console.log(`month ${months[0]}, ${summary.transactionCount} transactions, total ${summary.total.toFixed(2)}, uncategorized share ${(share * 100).toFixed(0)}%`);
  });
});
