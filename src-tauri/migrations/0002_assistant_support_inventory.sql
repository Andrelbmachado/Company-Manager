-- Ticket ownership, supplier inventory details and per-user AI settings.

ALTER TABLE tickets ADD COLUMN opened_by TEXT REFERENCES users(id);
ALTER TABLE tickets ADD COLUMN requester_area TEXT;
ALTER TABLE inventory_items ADD COLUMN supplier_id TEXT REFERENCES suppliers(id);

CREATE TABLE IF NOT EXISTS user_settings (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  key           TEXT NOT NULL,
  value_json    TEXT DEFAULT '{}',
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, key)
);
