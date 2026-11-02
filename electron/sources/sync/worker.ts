import { createScraper, CompanyTypes } from 'israeli-bank-scrapers';

/**
 * Runs in an isolated utility process with no access to the database. It receives the card-site
 * credentials in memory, logs in, returns the scraped accounts, and exits. Nothing is written to disk or logged.
 */
interface StartMessage {
  type: 'start';
  request: { id: string; card6Digits: string; password: string; months: number };
  executablePath: string;
}

const PROGRESS: Record<string, string> = {
  INITIALIZING: 'מכין את הדפדפן…',
  START_SCRAPING: 'מתחיל…',
  LOGGING_IN: 'מתחבר לאתר ישראכארט…',
  LOGIN_SUCCESS: 'ההתחברות הצליחה, מוריד עסקאות…',
  END_SCRAPING: 'מסיים…',
};

const port = process.parentPort;

port.on('message', async (e) => {
  const msg = e.data as StartMessage;
  if (msg.type !== 'start') return;
  try {
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - msg.request.months);
    const scraper = createScraper({
      companyId: CompanyTypes.isracard,
      startDate,
      combineInstallments: false,
      showBrowser: false,
      executablePath: msg.executablePath,
      defaultTimeout: 60_000,
    });
    scraper.onProgress((_company, payload) => {
      const text = PROGRESS[payload.type];
      if (text) port.postMessage({ type: 'progress', message: text });
    });
    const result = await scraper.scrape({
      id: msg.request.id,
      card6Digits: msg.request.card6Digits,
      password: msg.request.password,
    });
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
        })),
      })),
    });
  } catch {
    port.postMessage({ type: 'done', success: false, errorType: 'GENERAL_ERROR' });
  }
});
