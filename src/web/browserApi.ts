import { BackupError, makeBackup, parseBackup } from '../../shared/backup';
import type { ImportInput, ImportResult, PayMateApi, RestoreResult } from '../../shared/api';
import { readData, replaceData, updateData } from './idb';
import * as logic from './logic';

async function importOne(file: ImportInput): Promise<ImportResult> {
  const name = file.name;
  try {
    if (!/\.xlsx$/i.test(name)) throw new Error('נתמכים רק קובצי Excel (xlsx) של ישראכארט');
    // The parser and exceljs are large, so they load only when someone actually imports a file.
    const { parseIsracardBuffer } = await import('../../shared/import/isracard');
    const stmt = await parseIsracardBuffer(file.data);
    const { added, skipped } = await updateData((data) => logic.importStatement(data, stmt, name, 'excel'));
    const sum = stmt.transactions.reduce((s, t) => s + t.chargedAmount, 0);
    return {
      file: name,
      ok: true,
      month: stmt.chargeDate?.slice(0, 7) ?? stmt.month,
      cardLast4: stmt.cardLast4,
      added,
      skipped,
      totalMatches: stmt.statedTotal == null ? null : Math.abs(sum - stmt.statedTotal) < 0.05,
    };
  } catch (e) {
    return { file: name, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Asks the browser not to evict the data when storage runs low. Harmless when refused or unsupported. */
function requestPersistence() {
  try {
    void navigator.storage?.persist?.();
  } catch {
    // Not available here.
  }
}

export const browserApi: PayMateApi = {
  async months() { return logic.listMonths(await readData()); },
  async lastUpdate() { return logic.lastUpdate(await readData()); },
  async unknownMerchants(month) { return logic.unknownMerchants(await readData(), month); },
  async mapMerchant(merchant, key) {
    await updateData((data) => {
      if (key === 'other') logic.keepMerchantAsOther(data, merchant);
      else logic.assignMerchant(data, merchant, key);
    });
  },
  async undoMapMerchant(merchant) { await updateData((data) => logic.undoMerchant(data, merchant)); },
  async monthTotals() { return logic.monthTotals(await readData()); },
  async recurringTimeline() { return logic.recurringTimelineRows(await readData()); },
  async summary(month) { return logic.monthSummary(await readData(), month); },
  async transactions(month) { return logic.monthTransactions(await readData(), month); },
  async categories() { return logic.categoriesOf(await readData()); },
  async addCategory(name, color) { return updateData((data) => logic.addCategory(data, name, color)); },
  async setCategory(id, key, all) { await updateData((data) => logic.setCategory(data, id, key, all)); },
  async insights(month) { return logic.monthInsights(await readData(), month); },
  async budgets() { return logic.listBudgets(await readData()); },
  async setBudget(key, amount) { await updateData((data) => logic.setBudget(data, key, amount)); },
  async importFiles(files) {
    const results: ImportResult[] = [];
    for (const f of files) results.push(await importOne(f));
    if (results.some((r) => r.ok)) requestPersistence();
    return results;
  },
  async exportBackup() { return JSON.stringify(makeBackup(await readData())); },
  async restoreBackup(text): Promise<RestoreResult> {
    try {
      const data = parseBackup(text);
      await replaceData(data);
      requestPersistence();
      return { ok: true, transactions: data.transactions.length };
    } catch (e) {
      return { ok: false, error: e instanceof BackupError ? e.message : 'השחזור נכשל, והנתונים לא השתנו' };
    }
  },
};
