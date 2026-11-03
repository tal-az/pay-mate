import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATEGORY_SEEDS, categorize, makeCategory, type UserRule } from '../../shared/core/categorize';
import { FLAG_KINDS, MAX_FLAG_COMMENT, insightFlagKey, type Category, type FlagKind } from '../../shared/api';
import type { ParsedStatement } from '../../shared/types';

export type Db = DatabaseSync;

export function openDb(file: string, schemaDir = __dirname): Db {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(join(schemaDir, 'schema.sql'), 'utf-8'));
  // A database from before companies were recorded on imports keeps its table, so the column is added here.
  const importColumns = db.prepare('PRAGMA table_info(imports)').all() as Array<{ name: string }>;
  if (!importColumns.some((c) => c.name === 'company')) db.exec('ALTER TABLE imports ADD COLUMN company TEXT');
  const insert = db.prepare(
    'INSERT INTO categories (key, name, color) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET name = excluded.name, color = excluded.color',
  );
  for (const c of CATEGORY_SEEDS) insert.run(c.key, c.name, c.color);
  return db;
}

/** Adds a category the user made. */
export function addCategory(db: Db, name: string, color: string): Category {
  const existing = db.prepare('SELECT name FROM categories').all() as unknown as Array<{ name: string }>;
  const c = makeCategory(name, color, existing);
  const res = db.prepare('INSERT INTO categories (key, name, color) VALUES (?, ?, ?)').run(c.key, c.name, c.color);
  return { id: Number(res.lastInsertRowid), ...c };
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
    db.prepare('INSERT INTO imports (at, company, source, label, added, skipped) VALUES (?,?,?,?,?,?)').run(
      new Date().toISOString(), stmt.company, source, label, added, skipped,
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

/** Flags a transaction, or edits its flag; an edited flag stays resolved or open as it was. */
export function setFlag(db: Db, txId: string, kind: FlagKind, comment: string) {
  if (!FLAG_KINDS.includes(kind)) throw new Error(`unknown flag kind ${kind}`);
  const text = comment.trim();
  if (text.length > MAX_FLAG_COMMENT) throw new Error(`ההערה ארוכה מדי (עד ${MAX_FLAG_COMMENT} תווים)`);
  if (!db.prepare('SELECT 1 FROM transactions WHERE id = ?').get(txId)) throw new Error('transaction not found');
  db.prepare(
    `INSERT INTO tx_flags (tx_id, kind, comment, created_at) VALUES (?,?,?,?)
     ON CONFLICT(tx_id) DO UPDATE SET kind = excluded.kind, comment = excluded.comment`,
  ).run(txId, kind, text, new Date().toISOString());
}

export function resolveFlag(db: Db, txId: string, resolved: boolean) {
  db.prepare('UPDATE tx_flags SET resolved = ?, resolved_at = ? WHERE tx_id = ?').run(resolved ? 1 : 0, resolved ? new Date().toISOString() : null, txId);
}

export function clearFlag(db: Db, txId: string) {
  db.prepare('DELETE FROM tx_flags WHERE tx_id = ?').run(txId);
}

/** Adds an insight to the follow-up list, or edits its comment; an edited flag stays resolved or open as it was. */
export function setInsightFlag(db: Db, month: string, insight: { id: string; kind: string; text: string }, comment: string) {
  const note = comment.trim();
  if (note.length > MAX_FLAG_COMMENT) throw new Error(`ההערה ארוכה מדי (עד ${MAX_FLAG_COMMENT} תווים)`);
  db.prepare(
    `INSERT INTO insight_flags (key, month, insight_kind, text, comment, created_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT(key) DO UPDATE SET comment = excluded.comment`,
  ).run(insightFlagKey(month, insight.id), month, insight.kind, insight.text, note, new Date().toISOString());
}

export function resolveInsightFlag(db: Db, key: string, resolved: boolean) {
  db.prepare('UPDATE insight_flags SET resolved = ?, resolved_at = ? WHERE key = ?').run(resolved ? 1 : 0, resolved ? new Date().toISOString() : null, key);
}

export function clearInsightFlag(db: Db, key: string) {
  db.prepare('DELETE FROM insight_flags WHERE key = ?').run(key);
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
