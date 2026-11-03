import { app, BrowserWindow, ipcMain, shell, utilityProcess } from 'electron';
import { autoUpdater } from 'electron-updater';
import { join } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import {
  openDb, importStatement, setCategory, assignMerchant, keepMerchantAsOther, undoMerchant, addCategory, setFlag, resolveFlag, clearFlag, type Db,
} from './db/db';
import {
  listMonths, lastUpdate, unknownMerchants, monthTotals, recurringTimelineRows, listCategories, monthSummary, monthTransactions, monthInsights, listBudgets, setBudget, listFlags,
} from './db/queries';
import { parseIsracardBuffer } from '../shared/import/isracard';
import { exportBackup, restoreData } from './db/backup';
import { BackupError, parseBackup } from '../shared/backup';
import { mapAccounts, failureFromErrorType, failureMessage, type ScrapedAccount } from './sources/sync/map';
import type { FlagKind, ImportInput, ImportResult, RestoreResult, SyncRequest, SyncResult, SyncFailure } from '../shared/api';
import { findProvider, type ProviderKey } from '../shared/providers';

let db: Db;
let syncing = false;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'PayMate',
    backgroundColor: '#f4f2ff',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  void win.loadFile(join(__dirname, '../../dist/index.html'));
}

async function importOne({ name: file, data }: ImportInput): Promise<ImportResult> {
  try {
    if (!/\.xlsx$/i.test(file)) throw new Error('נתמכים רק קובצי Excel (xlsx) של ישראכארט');
    const stmt = await parseIsracardBuffer(data);
    const { added, skipped } = importStatement(db, stmt, file, 'excel');
    const sum = stmt.transactions.reduce((s, t) => s + t.chargedAmount, 0);
    return {
      file,
      ok: true,
      month: stmt.chargeDate?.slice(0, 7) ?? stmt.month,
      cardLast4: stmt.cardLast4,
      added,
      skipped,
      totalMatches: stmt.statedTotal == null ? null : Math.abs(sum - stmt.statedTotal) < 0.05,
    };
  } catch (e) {
    return { file, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}


const BROWSER_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];

interface WorkerDone {
  success: boolean;
  errorType?: string;
  accounts?: ScrapedAccount[];
}

const SYNC_TIMEOUT_MS = 5 * 60_000;

function fail(failure: SyncFailure, company?: ProviderKey): SyncResult {
  return { ok: false, failure, message: failureMessage(failure, company) };
}

/** Credentials live only in this call and the worker's memory. They are never stored or logged. */
async function runSync(request: SyncRequest, progress: (m: string) => void): Promise<SyncResult> {
  const provider = findProvider(request.company);
  if (syncing || !provider) return fail('unknown');
  const executablePath = BROWSER_CANDIDATES.find((p) => existsSync(p));
  if (!executablePath) return fail('no-browser');
  syncing = true;
  const child = utilityProcess.fork(join(__dirname, 'sources/sync/worker.js'), [], { serviceName: 'paymate-sync' });
  try {
    const done = await new Promise<WorkerDone | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), SYNC_TIMEOUT_MS);
      child.on('message', (m: { type: string; message?: string } & Partial<WorkerDone>) => {
        if (m.type === 'progress' && m.message) progress(m.message);
        if (m.type === 'done') { clearTimeout(timer); resolve(m as unknown as WorkerDone); }
      });
      child.on('exit', () => { clearTimeout(timer); resolve(null); });
      child.postMessage({ type: 'start', request, executablePath });
    });
    if (!done) return fail('timeout');
    if (!done.success || !done.accounts) return fail(failureFromErrorType(done.errorType), provider.key);
    let added = 0;
    let skipped = 0;
    for (const stmt of mapAccounts(done.accounts, provider.key)) {
      const r = importStatement(db, stmt, 'סנכרון אוטומטי', 'sync');
      added += r.added;
      skipped += r.skipped;
    }
    return { ok: true, added, skipped, cards: done.accounts.map((a) => a.accountNumber.slice(-4)) };
  } finally {
    child.kill();
    syncing = false;
  }
}

/**
 * Updates come only from this app's GitHub releases. They download in the background and install when the user
 * restarts. Nothing is checked in development, and every failure is silent: the app keeps working as it is.
 */
function setupUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  const broadcast = (status: { state: 'downloading' | 'ready'; version: string }) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('updateStatus', status);
  };
  autoUpdater.on('update-available', (info) => broadcast({ state: 'downloading', version: info.version }));
  autoUpdater.on('update-downloaded', (info) => broadcast({ state: 'ready', version: info.version }));
  autoUpdater.on('error', () => undefined);
  setTimeout(() => void autoUpdater.checkForUpdates().catch(() => undefined), 8_000);
}

function registerIpc() {
  ipcMain.handle('appVersion', () => app.getVersion());
  ipcMain.handle('checkForUpdates', async () => {
    if (app.isPackaged) await autoUpdater.checkForUpdates().catch(() => undefined);
  });
  ipcMain.handle('installUpdate', () => {
    if (app.isPackaged) autoUpdater.quitAndInstall();
  });
  ipcMain.handle('months', () => listMonths(db));
  ipcMain.handle('lastUpdate', () => lastUpdate(db));
  ipcMain.handle('unknownMerchants', (_e, month: string) => unknownMerchants(db, month));
  ipcMain.handle('mapMerchant', (_e, merchant: string, key: string) => {
    if (key === 'other') keepMerchantAsOther(db, merchant);
    else assignMerchant(db, merchant, key);
  });
  ipcMain.handle('undoMapMerchant', (_e, merchant: string) => undoMerchant(db, merchant));
  ipcMain.handle('monthTotals', () => monthTotals(db));
  ipcMain.handle('recurringTimeline', () => recurringTimelineRows(db));
  ipcMain.handle('categories', () => listCategories(db));
  ipcMain.handle('addCategory', (_e, name: string, color: string) => addCategory(db, name, color));
  ipcMain.handle('summary', (_e, month: string) => monthSummary(db, month));
  ipcMain.handle('transactions', (_e, month: string) => monthTransactions(db, month));
  ipcMain.handle('insights', (_e, month: string) => monthInsights(db, month));
  ipcMain.handle('setCategory', (_e, id: string, key: string, all: boolean) => setCategory(db, id, key, all));
  ipcMain.handle('setFlag', (_e, id: string, kind: FlagKind, comment: string) => setFlag(db, id, kind, comment));
  ipcMain.handle('resolveFlag', (_e, id: string, resolved: boolean) => resolveFlag(db, id, resolved));
  ipcMain.handle('clearFlag', (_e, id: string) => clearFlag(db, id));
  ipcMain.handle('flags', () => listFlags(db));
  ipcMain.handle('budgets', () => listBudgets(db));
  ipcMain.handle('setBudget', (_e, key: string, amount: number | null) => setBudget(db, key, amount));
  ipcMain.handle('sync', (e, request: SyncRequest) =>
    runSync(request, (m) => e.sender.send('syncProgress', m)),
  );
  ipcMain.handle('importFiles', async (_e, files: ImportInput[]) => {
    const results: ImportResult[] = [];
    for (const f of files) results.push(await importOne(f));
    return results;
  });
  ipcMain.handle('exportBackup', () => JSON.stringify(exportBackup(db)));
  ipcMain.handle('restoreBackup', (_e, text: string): RestoreResult => {
    try {
      const data = parseBackup(text);
      restoreData(db, data);
      return { ok: true, transactions: data.transactions.length };
    } catch (e) {
      return { ok: false, error: e instanceof BackupError ? e.message : 'השחזור נכשל, והנתונים לא השתנו' };
    }
  });
}

app.whenReady().then(() => {
  const dir = join(app.getPath('userData'), 'data');
  mkdirSync(dir, { recursive: true });
  db = openDb(join(dir, 'paymate.db'));
  registerIpc();
  createWindow();
  setupUpdates();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
