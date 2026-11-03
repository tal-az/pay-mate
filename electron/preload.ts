import { contextBridge, ipcRenderer } from 'electron';

const call = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

const subscribe = <T>(channel: string, callback: (value: T) => void) => {
  const listener = (_e: unknown, value: T) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('paymate', {
  months: () => call('months'),
  lastUpdate: () => call('lastUpdate'),
  unknownMerchants: (month: string) => call('unknownMerchants', month),
  mapMerchant: (merchant: string, key: string) => call('mapMerchant', merchant, key),
  undoMapMerchant: (merchant: string) => call('undoMapMerchant', merchant),
  cards: () => call('cards'),
  monthTotals: (card?: string) => call('monthTotals', card),
  recurringTimeline: (card?: string) => call('recurringTimeline', card),
  summary: (month: string, card?: string) => call('summary', month, card),
  transactions: (month: string, card?: string) => call('transactions', month, card),
  categories: () => call('categories'),
  addCategory: (name: string, color: string) => call('addCategory', name, color),
  setCategory: (id: string, key: string, all: boolean) => call('setCategory', id, key, all),
  setFlag: (id: string, kind: string, comment: string) => call('setFlag', id, kind, comment),
  resolveFlag: (id: string, resolved: boolean) => call('resolveFlag', id, resolved),
  clearFlag: (id: string) => call('clearFlag', id),
  flags: () => call('flags'),
  setInsightFlag: (month: string, insight: unknown, comment: string) => call('setInsightFlag', month, insight, comment),
  resolveInsightFlag: (key: string, resolved: boolean) => call('resolveInsightFlag', key, resolved),
  clearInsightFlag: (key: string) => call('clearInsightFlag', key),
  insightFlags: () => call('insightFlags'),
  insights: (month: string, card?: string) => call('insights', month, card),
  budgets: () => call('budgets'),
  setBudget: (key: string, amount: number | null) => call('setBudget', key, amount),
  importFiles: (files: unknown) => call('importFiles', files),
  exportBackup: () => call('exportBackup'),
  restoreBackup: (text: string) => call('restoreBackup', text),
  desktop: {
    sync: (request: unknown) => call('sync', request),
    onSyncProgress: (callback: (message: string) => void) => subscribe('syncProgress', callback),
    appVersion: () => call('appVersion'),
    checkForUpdates: () => call('checkForUpdates'),
    installUpdate: () => call('installUpdate'),
    onUpdateStatus: (callback: (status: unknown) => void) => subscribe('updateStatus', callback),
  },
});
