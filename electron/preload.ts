import { contextBridge, ipcRenderer, webUtils } from 'electron';

const call = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('paymate', {
  months: () => call('months'),
  lastUpdate: () => call('lastUpdate'),
  unknownMerchants: (month: string) => call('unknownMerchants', month),
  mapMerchant: (merchant: string, key: string) => call('mapMerchant', merchant, key),
  undoMapMerchant: (merchant: string) => call('undoMapMerchant', merchant),
  monthTotals: () => call('monthTotals'),
  recurringTimeline: () => call('recurringTimeline'),
  summary: (month: string) => call('summary', month),
  transactions: (month: string) => call('transactions', month),
  categories: () => call('categories'),
  setCategory: (id: string, key: string, all: boolean) => call('setCategory', id, key, all),
  insights: (month: string) => call('insights', month),
  budgets: () => call('budgets'),
  setBudget: (key: string, amount: number | null) => call('setBudget', key, amount),
  pickFiles: () => call('pickFiles'),
  importFiles: (paths: string[]) => call('importFiles', paths),
  sync: (request: unknown) => call('sync', request),
  onSyncProgress: (callback: (message: string) => void) => {
    const listener = (_e: unknown, message: string) => callback(message);
    ipcRenderer.on('syncProgress', listener);
    return () => ipcRenderer.removeListener('syncProgress', listener);
  },
  appVersion: () => call('appVersion'),
  checkForUpdates: () => call('checkForUpdates'),
  installUpdate: () => call('installUpdate'),
  onUpdateStatus: (callback: (status: unknown) => void) => {
    const listener = (_e: unknown, status: unknown) => callback(status);
    ipcRenderer.on('updateStatus', listener);
    return () => ipcRenderer.removeListener('updateStatus', listener);
  },
  pathForFile: (file: File) => webUtils.getPathForFile(file),
});
