CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  color TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS merchant_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL UNIQUE,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  origin TEXT NOT NULL DEFAULT 'user'
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  company TEXT NOT NULL,
  card_last4 TEXT NOT NULL,
  purchase_date TEXT NOT NULL,
  charge_date TEXT,
  raw_merchant TEXT NOT NULL,
  merchant TEXT NOT NULL,
  original_amount REAL NOT NULL,
  original_currency TEXT NOT NULL,
  charged_amount REAL NOT NULL,
  charged_currency TEXT NOT NULL,
  voucher TEXT,
  standing_order INTEGER NOT NULL DEFAULT 0,
  foreign_site INTEGER NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  details TEXT NOT NULL DEFAULT '',
  category_id INTEGER REFERENCES categories(id),
  category_locked INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(purchase_date);
CREATE INDEX IF NOT EXISTS idx_tx_merchant ON transactions(merchant);

CREATE TABLE IF NOT EXISTS budgets (
  category_id INTEGER PRIMARY KEY REFERENCES categories(id),
  monthly_amount REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  source TEXT NOT NULL,
  label TEXT NOT NULL,
  added INTEGER NOT NULL,
  skipped INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS merchant_reviews (
  merchant_key TEXT PRIMARY KEY,
  decided_at TEXT NOT NULL
);
