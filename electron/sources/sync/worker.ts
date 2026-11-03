import { createScraper, CompanyTypes } from 'israeli-bank-scrapers';
import { findProvider, type ProviderKey } from '../../../shared/providers';
import type { SyncRequest } from '../../../shared/api';

/**
 * Runs in an isolated utility process with no access to the database. It receives the card-site
 * credentials in memory, logs in, returns the scraped accounts, and exits. Nothing is written to disk or logged.
 */
interface StartMessage {
  type: 'start';
  request: SyncRequest;
  executablePath: string;
}

const COMPANIES: Record<ProviderKey, CompanyTypes> = {
  isracard: CompanyTypes.isracard,
  amex: CompanyTypes.amex,
  max: CompanyTypes.max,
  visaCal: CompanyTypes.visaCal,
};

const progressText = (name: string): Record<string, string> => ({
  INITIALIZING: 'מכין את הדפדפן…',
  START_SCRAPING: 'מתחיל…',
  LOGGING_IN: `מתחבר לאתר ${name}…`,
  LOGIN_SUCCESS: 'ההתחברות הצליחה, מוריד עסקאות…',
  END_SCRAPING: 'מסיים…',
});

const port = process.parentPort;

port.on('message', async (e) => {
  const msg = e.data as StartMessage;
  if (msg.type !== 'start') return;
  try {
    const provider = findProvider(msg.request.company);
    if (!provider) throw new Error('unknown company');
    const progress = progressText(provider.name);
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - msg.request.months);
    const scraper = createScraper({
      companyId: COMPANIES[provider.key],
      startDate,
      combineInstallments: false,
      showBrowser: false,
      executablePath: msg.executablePath,
      defaultTimeout: 60_000,
    });
    scraper.onProgress((_company, payload) => {
      const text = progress[payload.type];
      if (text) port.postMessage({ type: 'progress', message: text });
    });
    const credentials = Object.fromEntries(provider.fields.map((f) => [f.name, msg.request.credentials[f.name] ?? '']));
    const result = await scraper.scrape(credentials as unknown as Parameters<typeof scraper.scrape>[0]);
    port.postMessage({
      type: 'done',
      success: result.success,
      errorType: result.errorType,
      accounts: result.accounts?.map((a) => ({
        accountNumber: a.accountNumber,
        txns: a.txns.map((t) => ({
          identifier: t.identifier,
          date: t.date,
          processedDate: t.processedDate,
          originalAmount: t.originalAmount,
          originalCurrency: t.originalCurrency,
          chargedAmount: t.chargedAmount,
          chargedCurrency: t.chargedCurrency,
          description: t.description,
          memo: t.memo,
          status: t.status,
          installmentNumber: t.installments?.number,
        })),
      })),
    });
  } catch {
    port.postMessage({ type: 'done', success: false, errorType: 'GENERAL_ERROR' });
  }
});
