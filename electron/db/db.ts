import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATEGORY_SEEDS, categorize, type UserRule } from '../core/categorize';
import type { ParsedStatement } from '../../shared/types';

export type Db = DatabaseSync;

export function openDb(file: string, schemaDir = __dirname): Db {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(join(schemaDir, 'schema.sql'), 'utf-8'));
  const insert = db.prepare(
    'INSERT INTO categories (key, name, color) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET name = excluded.name, color = excluded.color',
  );
  for (const c of CATEGORY_SEEDS) insert.run(c.key, c.name, c.color);
  return db;
}

function categoryIds(db: Db): Map<string, number> {
  const rows = db.prepare('SELECT id, key FROM categories').all() as Array<{ id: number; key: string }>;
  return new Map(rows.map((r) => [r.key, r.id]));
}

function userRules(db: Db): UserRule[] {
  return db
    .prepare(
      `SELECT r.pattern AS pattern, c.key AS categoryKey
       FROM merchant_rules r JOIN categories c ON c.id = r.category_id
       WHERE r.origin = ? ORDER BY length(r.pattern) DESC`,
    )
    .all('user') as unknown as UserRule[];
}

/** Inserts new transactions; ones already present (same id) are skipped, so re-imports are safe. */
export function importStatement(db: Db, stmt: ParsedStatement, label: string, source: 'excel' | 'sync') {
  const ids = categoryIds(db);
  const rules = userRules(db);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO transactions
      (id, company, card_last4, purchase_date, charge_date, raw_merchant, merchant, original_amount,
       original_currency, charged_amount, charged_currency, voucher, standing_order, foreign_site,
       discount, details, category_id, source)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  let added = 0;
  let skipped = 0;
  db.exec('BEGIN');
  try {
    for (const t of stmt.transactions) {
      const key = categorize(t, rules);
      const res = insert.run(
        t.id, t.company, t.cardLast4, t.purchaseDate, t.chargeDate, t.rawMerchant, t.merchant,
        t.originalAmount, t.originalCurrency, t.chargedAmount, t.chargedCurrency, t.voucher,
        t.standingOrder ? 1 : 0, t.foreignSite ? 1 : 0, t.discount, t.details, ids.get(key) ?? null, source,
      );
      if (Number(res.changes) > 0) added++;
      else skipped++;
    }
    db.prepare('INSERT INTO imports (at, source, label, added, skipped) VALUES (?,?,?,?,?)').run(
      new Date().toISOString(), source, label, added, skipped,
    );
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { added, skipped };
}

/** Sets a category by hand and, optionally, remembers it for every transaction from that business. */
export function setCategory(db: Db, txId: string, categoryKey: string, applyToMerchant: boolean) {
  const catId = categoryIds(db).get(categoryKey);
  if (catId == null) throw new Error(`unknown category ${categoryKey}`);
  const tx = db.prepare('SELECT merchant FROM transactions WHERE id = ?').get(txId) as { merchant: string } | undefined;
  if (!tx) throw new Error('transaction not found');
  if (applyToMerchant) {
    db.prepare(
      `INSERT INTO merchant_rules (pattern, category_id, origin) VALUES (?, ?, ?)
       ON CONFLICT(pattern) DO UPDATE SET category_id = excluded.category_id`,
    ).run(tx.merchant.toLowerCase(), catId, 'user');
    db.prepare('UPDATE transactions SET category_id = ? WHERE merchant = ? AND category_locked = 0').run(catId, tx.merchant);
  }
  db.prepare('UPDATE transactions SET category_id = ?, category_locked = 1 WHERE id = ?').run(catId, txId);
}

/** Maps every charge from this business, in all months, to a category, and remembers it for future imports. Returns how many charges changed. */
export function assignMerchant(db: Db, merchant: string, categoryKey: string): number {
  const catId = categoryIds(db).get(categoryKey);
  if (catId == null) throw new Error(`unknown category ${categoryKey}`);
  db.prepare(
    `INSERT INTO merchant_rules (pattern, category_id, origin) VALUES (?, ?, ?)
     ON CONFLICT(pattern) DO UPDATE SET category_id = excluded.category_id`,
  ).run(merchant.toLowerCase(), catId, 'user');
  db.prepare('DELETE FROM merchant_reviews WHERE merchant_key = ?').run(merchant);
  const res = db.prepare('UPDATE transactions SET category_id = ? WHERE merchant = ? AND category_locked = 0').run(catId, merchant);
  return Number(res.changes);
}

/** The user looked at this business and chose to leave it as "other", so it is not asked about again. */
export function keepMerchantAsOther(db: Db, merchant: string) {
  db.prepare('INSERT OR REPLACE INTO merchant_reviews (merchant_key, decided_at) VALUES (?, ?)').run(merchant, new Date().toISOString());
}

/** Reverses assignMerchant or keepMerchantAsOther: the business goes back to being unknown. */
export function undoMerchant(db: Db, merchant: string) {
  const other = categoryIds(db).get('other');
  db.prepare('DELETE FROM merchant_rules WHERE pattern = ? AND origin = ?').run(merchant.toLowerCase(), 'user');
  db.prepare('DELETE FROM merchant_reviews WHERE merchant_key = ?').run(merchant);
  if (other != null) {
    db.prepare('UPDATE transactions SET category_id = ? WHERE merchant = ? AND category_locked = 0').run(other, merchant);
  }
}
