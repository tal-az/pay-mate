import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { browserApi } from '../src/web/browserApi';
import { readData, replaceData, updateData } from '../src/web/idb';
import { emptyData } from '../shared/backup';
import { parseIsracardBuffer, parseIsracardWorkbook } from '../shared/import/isracard';

/** A synthetic workbook laid out like a real Isracard export. */
function workbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('פירוט עסקאות');
  ws.getCell('C2').value = 'אוקטובר 2026';
  ws.getCell('A5').value = 'גולד - מסטרקארד - 1234';
  ws.getCell('H6').value = 'לחיוב ב-02.10';
  ws.getRow(10).values = ['תאריך רכישה', 'שם בית עסק', 'סכום עסקה', 'מטבע עסקה', 'סכום חיוב', 'מטבע חיוב', "מס' שובר", 'פירוט נוסף'];
  ws.getRow(11).values = ['01.10.26', 'קפה לדוגמה   ', 40, '₪', 40, '₪', '111', ''];
  ws.getRow(12).values = ['29.09.26', 'APPLE.COM/BILL           ', 11.9, '₪', 11.9, '₪', '222', 'אתר חו"ל\nהוראת קבע'];
  ws.getRow(13).values = ['23.09.26', 'חנות מסתורית', 100, '₪', 100, '₪', '', ''];
  ws.getRow(14).values = [null, 'סה"כ לחיוב החודש בכרטיס בש"ח', null, null, 151.9, '₪'];
  return wb;
}

const xlsx = async (): Promise<ArrayBuffer> => {
  const buf = await workbook().xlsx.writeBuffer();
  return (buf as Uint8Array).buffer.slice((buf as Uint8Array).byteOffset, (buf as Uint8Array).byteOffset + (buf as Uint8Array).byteLength) as ArrayBuffer;
};

/**
 * Rewrites a normal .xlsx the way Isracard's exporter writes it: absolute relationship targets and a prefix on
 * every spreadsheet element. This is the shape exceljs cannot read without the importer's repair step.
 */
async function isracardStyle(data: ArrayBuffer): Promise<Uint8Array> {
  const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const zip = await JSZip.loadAsync(data);
  for (const name of Object.keys(zip.files)) {
    if (zip.files[name].dir) continue;
    let xml = await zip.files[name].async('string');
    if (name.endsWith('.rels')) {
      const baseDir = name.split('/').slice(0, -2).join('/');
      xml = xml.replace(/Target="([^"/][^"]*)"/g, (_m, t: string) => `Target="/${baseDir ? baseDir + '/' : ''}${t}"`);
    } else if (name.endsWith('.xml') && xml.includes(`xmlns="${MAIN}"`)) {
      xml = xml.replace(`xmlns="${MAIN}"`, `xmlns:x="${MAIN}"`).replace(/<(\/?)(?![?!])([A-Za-z][A-Za-z0-9]*)(?=[\s/>])/g, '<$1x:$2');
    }
    zip.file(name, xml);
  }
  return zip.generateAsync({ type: 'uint8array' });
}

describe('parseIsracardBuffer', () => {
  it('reads a standard .xlsx from bytes', async () => {
    const stmt = await parseIsracardBuffer(await xlsx());
    expect(stmt.cardLast4).toBe('1234');
    expect(stmt.transactions.map((t) => t.merchant)).toEqual(['קפה לדוגמה', 'APPLE.COM/BILL', 'חנות מסתורית']);
    expect(stmt.statedTotal).toBe(151.9);
  });

  it('reads the package layout Isracard writes (absolute targets, prefixed elements)', async () => {
    const styled = await isracardStyle(await xlsx());
    // Sanity check on the fixture itself: the unrepaired file really is in the awkward shape.
    const zip = await JSZip.loadAsync(styled);
    const rels = await zip.files['_rels/.rels'].async('string');
    expect(rels).toMatch(/Target="\/xl\//);
    const sheet = await zip.files['xl/worksheets/sheet1.xml'].async('string');
    expect(sheet).toContain('<x:sheetData');

    const stmt = await parseIsracardBuffer(styled);
    const plain = parseIsracardWorkbook(workbook());
    expect(stmt.transactions.map((t) => t.id)).toEqual(plain.transactions.map((t) => t.id));
    expect(stmt.transactions).toHaveLength(3);
  });

  it('gives a voucher-less row the same fallback id every time', async () => {
    const a = await parseIsracardBuffer(await xlsx());
    const b = await parseIsracardBuffer(await xlsx());
    expect(a.transactions[2].id).toBe(b.transactions[2].id);
    expect(a.transactions[2].id).toMatch(/^isracard:1234:[0-9a-f]{20}$/);
  });
});

describe('IndexedDB layer', () => {
  beforeEach(async () => { await replaceData(emptyData()); });

  it('persists a change', async () => {
    await updateData((d) => { d.budgets.push({ categoryKey: 'groceries', monthlyAmount: 5 }); });
    expect((await readData()).budgets).toEqual([{ categoryKey: 'groceries', monthlyAmount: 5 }]);
  });

  it('rolls back a change that throws', async () => {
    await updateData((d) => { d.budgets.push({ categoryKey: 'groceries', monthlyAmount: 5 }); });
    await expect(updateData((d) => { d.budgets.length = 0; throw new Error('boom'); })).rejects.toThrow('boom');
    expect((await readData()).budgets).toHaveLength(1);
  });

  it('does not lose changes made at the same moment', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => updateData((d) => { d.reviews.push({ merchantKey: `m${i}`, decidedAt: 'x' }); })));
    expect((await readData()).reviews).toHaveLength(20);
  });
});

describe('browser API, end to end', () => {
  beforeEach(async () => { await replaceData(emptyData()); });

  it('imports a file, skips it the second time, and keeps the data', async () => {
    const data = await xlsx();
    const [first] = await browserApi.importFiles([{ name: 'oct.xlsx', data }]);
    expect(first).toMatchObject({ ok: true, added: 3, skipped: 0, cardLast4: '1234', month: '2026-10', totalMatches: true });
    const [second] = await browserApi.importFiles([{ name: 'oct.xlsx', data }]);
    expect(second).toMatchObject({ ok: true, added: 0, skipped: 3 });

    expect(await browserApi.months()).toEqual(['2026-10']);
    const summary = await browserApi.summary('2026-10');
    expect(summary.transactionCount).toBe(3);
    expect(summary.total).toBeCloseTo(151.9);
    expect((await browserApi.lastUpdate())?.source).toBe('excel');
  });

  it('reports a bad file without importing anything', async () => {
    const results = await browserApi.importFiles([
      { name: 'notes.txt', data: new TextEncoder().encode('hello').buffer as ArrayBuffer },
      { name: 'broken.xlsx', data: new TextEncoder().encode('not a zip').buffer as ArrayBuffer },
    ]);
    expect(results.map((r) => r.ok)).toEqual([false, false]);
    expect(await browserApi.months()).toEqual([]);
  });

  it('maps a business, remembers it, and undoes it', async () => {
    await browserApi.importFiles([{ name: 'oct.xlsx', data: await xlsx() }]);
    expect((await browserApi.unknownMerchants('2026-10')).map((m) => m.merchant)).toContain('חנות מסתורית');
    await browserApi.mapMerchant('חנות מסתורית', 'health');
    expect((await browserApi.unknownMerchants('2026-10')).map((m) => m.merchant)).not.toContain('חנות מסתורית');
    await browserApi.undoMapMerchant('חנות מסתורית');
    expect((await browserApi.unknownMerchants('2026-10')).map((m) => m.merchant)).toContain('חנות מסתורית');
  });

  it('flags a transaction, keeps the flag across a backup, and resolves it', async () => {
    await browserApi.importFiles([{ name: 'oct.xlsx', data: await xlsx() }]);
    const [first] = await browserApi.transactions('2026-10');
    await browserApi.setFlag(first.id, 'suspicious', 'לבדוק');
    expect((await browserApi.transactions('2026-10')).find((t) => t.id === first.id)!.flag)
      .toEqual({ kind: 'suspicious', resolved: false, comment: 'לבדוק' });

    const backup = await browserApi.exportBackup();
    await replaceData(emptyData());
    await browserApi.restoreBackup(backup);
    expect(await browserApi.flags()).toMatchObject([{ txId: first.id, kind: 'suspicious', resolved: false }]);

    await browserApi.resolveFlag(first.id, true);
    expect((await browserApi.flags())[0].resolved).toBe(true);
    await browserApi.clearFlag(first.id);
    expect(await browserApi.flags()).toEqual([]);
  });

  it('backs up, loses everything, and restores', async () => {
    await browserApi.importFiles([{ name: 'oct.xlsx', data: await xlsx() }]);
    await browserApi.mapMerchant('חנות מסתורית', 'health');
    await browserApi.setBudget('groceries', 700);
    const backup = await browserApi.exportBackup();

    await replaceData(emptyData());
    expect(await browserApi.months()).toEqual([]);

    expect(await browserApi.restoreBackup(backup)).toEqual({ ok: true, transactions: 3 });
    expect(await browserApi.months()).toEqual(['2026-10']);
    expect(await browserApi.budgets()).toEqual([{ categoryKey: 'groceries', monthlyAmount: 700 }]);
    const [again] = await browserApi.importFiles([{ name: 'oct.xlsx', data: await xlsx() }]);
    expect(again.added).toBe(0);
  });

  it('refuses a bad backup and keeps the current data', async () => {
    await browserApi.importFiles([{ name: 'oct.xlsx', data: await xlsx() }]);
    const res = await browserApi.restoreBackup('{"format":"paymate-backup","version":1,"transactions":[{"id":1}]}');
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
    expect(await browserApi.months()).toEqual(['2026-10']);
  });
});
