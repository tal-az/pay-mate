import type { Db } from './db';
import {
  makeBackup, type Backup, type BackupBudget, type BackupData, type BackupImport, type BackupReview, type BackupRule, type BackupTransaction,
} from '../../shared/backup';

interface TxDbRow {
  id: string; company: string; card_last4: string; purchase_date: string; charge_date: string | null; raw_merchant: string;
  merchant: string; original_amount: number; original_currency: string; charged_amount: number; charged_currency: string;
  voucher: string | null; standing_order: number; foreign_site: number; discount: number; details: string;
  category_key: string | null; category_locked: number; source: 'excel' | 'sync';
}

/** Reads the whole database into the exchange format shared with the website. */
export function exportData(db: Db): BackupData {
  const transactions = (db
    .prepare(
      `SELECT t.id, t.company, t.card_last4, t.purchase_date, t.charge_date, t.raw_merchant, t.merchant, t.original_amount,
              t.original_currency, t.charged_amount, t.charged_currency, t.voucher, t.standing_order, t.foreign_site,
              t.discount, t.details, c.key AS category_key, t.category_locked, t.source
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id ORDER BY t.rowid`,
    )
    .all() as unknown as TxDbRow[]).map((r): BackupTransaction => ({
    id: r.id,
    company: r.company,
    cardLast4: r.card_last4,
    purchaseDate: r.purchase_date,
    chargeDate: r.charge_date,
    rawMerchant: r.raw_merchant,
    merchant: r.merchant,
    originalAmount: r.original_amount,
    originalCurrency: r.original_currency,
    chargedAmount: r.charged_amount,
    chargedCurrency: r.charged_currency,
    voucher: r.voucher,
    standingOrder: r.standing_order === 1,
    foreignSite: r.foreign_site === 1,
    discount: r.discount,
    details: r.details,
    categoryKey: r.category_key ?? 'other',
    categoryLocked: r.category_locked === 1,
    source: r.source,
  }));
  const rules = db
    .prepare('SELECT r.pattern AS pattern, c.key AS categoryKey, r.origin AS origin FROM merchant_rules r JOIN categories c ON c.id = r.category_id ORDER BY r.id')
    .all() as unknown as BackupRule[];
  const reviews = db
    .prepare('SELECT merchant_key AS merchantKey, decided_at AS decidedAt FROM merchant_reviews ORDER BY merchant_key')
    .all() as unknown as BackupReview[];
  const budgets = db
    .prepare('SELECT c.key AS categoryKey, b.monthly_amount AS monthlyAmount FROM budgets b JOIN categories c ON c.id = b.category_id ORDER BY c.id')
    .all() as unknown as BackupBudget[];
  const imports = db
    .prepare('SELECT at, source, label, added, skipped FROM imports ORDER BY id')
    .all() as unknown as BackupImport[];
  return { transactions, rules, reviews, budgets, imports };
}

export function exportBackup(db: Db): Backup {
  return makeBackup(exportData(db));
}

/** Replaces everything in the database with the backup's data, all or nothing. */
export function restoreData(db: Db, data: BackupData) {
  const ids = new Map((db.prepare('SELECT id, key FROM categories').all() as Array<{ id: number; key: string }>).map((r) => [r.key, r.id]));
  const other = ids.get('other')!;
  const idOf = (key: string) => ids.get(key) ?? other;

  db.exec('BEGIN');
  try {
    for (const table of ['transactions', 'merchant_rules', 'merchant_reviews', 'budgets', 'imports']) db.exec(`DELETE FROM ${table}`);
    const insertTx = db.prepare(
      `INSERT INTO transactions
        (id, company, card_last4, purchase_date, charge_date, raw_merchant, merchant, original_amount, original_currency,
         charged_amount, charged_currency, voucher, standing_order, foreign_site, discount, details, category_id, category_locked, source)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    for (const t of data.transactions) {
      insertTx.run(
        t.id, t.company, t.cardLast4, t.purchaseDate, t.chargeDate, t.rawMerchant, t.merchant, t.originalAmount, t.originalCurrency,
        t.chargedAmount, t.chargedCurrency, t.voucher, t.standingOrder ? 1 : 0, t.foreignSite ? 1 : 0, t.discount, t.details,
        idOf(t.categoryKey), t.categoryLocked ? 1 : 0, t.source,
      );
    }
    const insertRule = db.prepare('INSERT INTO merchant_rules (pattern, category_id, origin) VALUES (?,?,?)');
    for (const r of data.rules) insertRule.run(r.pattern, idOf(r.categoryKey), r.origin);
    const insertReview = db.prepare('INSERT INTO merchant_reviews (merchant_key, decided_at) VALUES (?,?)');
    for (const r of data.reviews) insertReview.run(r.merchantKey, r.decidedAt);
    const insertBudget = db.prepare('INSERT INTO budgets (category_id, monthly_amount) VALUES (?,?)');
    for (const b of data.budgets) insertBudget.run(idOf(b.categoryKey), b.monthlyAmount);
    const insertImport = db.prepare('INSERT INTO imports (at, source, label, added, skipped) VALUES (?,?,?,?,?)');
    for (const i of data.imports) insertImport.run(i.at, i.source, i.label, i.added, i.skipped);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
