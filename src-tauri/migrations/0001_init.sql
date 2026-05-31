-- ============================================================
-- Company Manager – Schema V1 (SQLite)
-- Migration: 0001_init
-- Convenções:
--   - IDs em TEXT (UUID gerado na aplicação)
--   - timestamps em TEXT ISO-8601 (default datetime('now'))
--   - company_id em quase tudo (multiempresa)
--   - deleted_at para soft delete (nunca DELETE no fluxo normal)
--   - FKs ativadas; índices em company_id/status/datas
-- ============================================================

PRAGMA foreign_keys = ON;

-- ----------------------------------------------------------------
-- NÚCLEO / ORGANIZAÇÃO
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS companies (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  document      TEXT,
  settings_json TEXT DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  avatar_path   TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  locale        TEXT DEFAULT 'pt-BR',
  last_login_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);

CREATE TABLE IF NOT EXISTS departments (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  name          TEXT NOT NULL,
  manager_id    TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);

CREATE TABLE IF NOT EXISTS memberships (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  role          TEXT NOT NULL DEFAULT 'tecnico',
  department_id TEXT REFERENCES departments(id),
  scope         TEXT NOT NULL DEFAULT 'proprio',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT,
  UNIQUE (company_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_company ON memberships(company_id);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);

-- ----------------------------------------------------------------
-- RELACIONAMENTO (CRM / COMERCIAL)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  type          TEXT NOT NULL DEFAULT 'PJ',
  name          TEXT NOT NULL,
  document      TEXT,
  email         TEXT,
  phone         TEXT,
  address_json  TEXT DEFAULT '{}',
  segment       TEXT,
  owner_id      TEXT REFERENCES users(id),
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_customers_company ON customers(company_id);

CREATE TABLE IF NOT EXISTS contacts (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  customer_id   TEXT REFERENCES customers(id),
  name          TEXT NOT NULL,
  email         TEXT,
  phone         TEXT,
  role          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_contacts_customer ON contacts(customer_id);

CREATE TABLE IF NOT EXISTS leads (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  name          TEXT NOT NULL,
  email         TEXT,
  phone         TEXT,
  source        TEXT,
  status        TEXT NOT NULL DEFAULT 'novo',
  score         INTEGER DEFAULT 0,
  owner_id      TEXT REFERENCES users(id),
  customer_id   TEXT REFERENCES customers(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_leads_company_status ON leads(company_id, status);

CREATE TABLE IF NOT EXISTS opportunities (
  id                  TEXT PRIMARY KEY,
  company_id          TEXT NOT NULL REFERENCES companies(id),
  customer_id         TEXT REFERENCES customers(id),
  title               TEXT NOT NULL,
  value               REAL DEFAULT 0,
  stage               TEXT NOT NULL DEFAULT 'novo',
  probability         INTEGER DEFAULT 0,
  expected_close_date TEXT,
  owner_id            TEXT REFERENCES users(id),
  lost_reason         TEXT,
  status              TEXT NOT NULL DEFAULT 'open',
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_opps_company_stage ON opportunities(company_id, stage);

CREATE TABLE IF NOT EXISTS proposals (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id),
  opportunity_id  TEXT REFERENCES opportunities(id),
  value           REAL DEFAULT 0,
  items_json      TEXT DEFAULT '[]',
  version         INTEGER DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'rascunho',
  document_id     TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT
);

-- ----------------------------------------------------------------
-- PROJETOS / TAREFAS
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  customer_id   TEXT REFERENCES customers(id),
  contract_id   TEXT,
  name          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'planejado',
  budget        REAL DEFAULT 0,
  start_date    TEXT,
  end_date      TEXT,
  owner_id      TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_projects_company_status ON projects(company_id, status);

CREATE TABLE IF NOT EXISTS tasks (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id),
  project_id      TEXT REFERENCES projects(id),
  parent_task_id  TEXT REFERENCES tasks(id),
  title           TEXT NOT NULL,
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'aberta',
  assignee_id     TEXT REFERENCES users(id),
  priority        TEXT NOT NULL DEFAULT 'media',
  due_date        TEXT,
  estimate_hours  REAL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_company_status ON tasks(company_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);

-- ----------------------------------------------------------------
-- SUPORTE / OPERAÇÕES
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tickets (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id),
  customer_id     TEXT REFERENCES customers(id),
  subject         TEXT NOT NULL,
  description     TEXT,
  channel         TEXT DEFAULT 'manual',
  priority        TEXT NOT NULL DEFAULT 'media',
  status          TEXT NOT NULL DEFAULT 'aberto',
  sla_due_at      TEXT,
  agent_id        TEXT REFERENCES users(id),
  asset_id        TEXT,
  work_order_id   TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_tickets_company_status ON tickets(company_id, status);

CREATE TABLE IF NOT EXISTS work_orders (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id),
  number          TEXT NOT NULL,
  customer_id     TEXT REFERENCES customers(id),
  ticket_id       TEXT REFERENCES tickets(id),
  project_id      TEXT REFERENCES projects(id),
  technician_id   TEXT REFERENCES users(id),
  status          TEXT NOT NULL DEFAULT 'aberta',
  priority        TEXT NOT NULL DEFAULT 'media',
  sla_due_at      TEXT,
  opened_at       TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at       TEXT,
  checklist_json  TEXT DEFAULT '[]',
  labor_cost      REAL DEFAULT 0,
  materials_cost  REAL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT,
  UNIQUE (company_id, number)
);
CREATE INDEX IF NOT EXISTS idx_wo_company_status ON work_orders(company_id, status);
CREATE INDEX IF NOT EXISTS idx_wo_technician ON work_orders(technician_id);

-- ----------------------------------------------------------------
-- ESTOQUE / CUSTÓDIA
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_items (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  name          TEXT NOT NULL,
  sku           TEXT,
  category      TEXT,
  unit          TEXT DEFAULT 'un',
  min_stock     REAL DEFAULT 0,
  max_stock     REAL,
  cost          REAL DEFAULT 0,
  photo_path    TEXT,
  qr_code       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_items_company ON inventory_items(company_id);
CREATE INDEX IF NOT EXISTS idx_items_sku ON inventory_items(company_id, sku);

CREATE TABLE IF NOT EXISTS stock_locations (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  name          TEXT NOT NULL,
  type          TEXT DEFAULT 'deposito',
  address       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);

CREATE TABLE IF NOT EXISTS stock_balances (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  item_id       TEXT NOT NULL REFERENCES inventory_items(id),
  location_id   TEXT NOT NULL REFERENCES stock_locations(id),
  quantity      REAL NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (item_id, location_id)
);
CREATE INDEX IF NOT EXISTS idx_balances_company ON stock_balances(company_id);

CREATE TABLE IF NOT EXISTS stock_movements (
  id                TEXT PRIMARY KEY,
  company_id        TEXT NOT NULL REFERENCES companies(id),
  item_id           TEXT NOT NULL REFERENCES inventory_items(id),
  type              TEXT NOT NULL,
  quantity          REAL NOT NULL,
  from_location_id  TEXT REFERENCES stock_locations(id),
  to_location_id    TEXT REFERENCES stock_locations(id),
  ref_type          TEXT,
  ref_id            TEXT,
  user_id           TEXT REFERENCES users(id),
  note              TEXT,
  evidence_path     TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_movements_company ON stock_movements(company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_movements_item ON stock_movements(item_id);

CREATE TABLE IF NOT EXISTS custodies (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id),
  item_id         TEXT REFERENCES inventory_items(id),
  asset_id        TEXT,
  holder_id       TEXT NOT NULL REFERENCES users(id),
  quantity        REAL NOT NULL DEFAULT 1,
  work_order_id   TEXT REFERENCES work_orders(id),
  checked_out_at  TEXT NOT NULL DEFAULT (datetime('now')),
  due_back_at     TEXT,
  returned_at     TEXT,
  status          TEXT NOT NULL DEFAULT 'em_custodia',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_custody_holder ON custodies(holder_id, status);
CREATE INDEX IF NOT EXISTS idx_custody_company ON custodies(company_id, status);

CREATE TABLE IF NOT EXISTS suppliers (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  name          TEXT NOT NULL,
  document      TEXT,
  email         TEXT,
  phone         TEXT,
  terms         TEXT,
  rating        INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);

-- ----------------------------------------------------------------
-- FINANCEIRO
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cost_centers (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  name          TEXT NOT NULL,
  department_id TEXT REFERENCES departments(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);

CREATE TABLE IF NOT EXISTS payables (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id),
  description     TEXT NOT NULL,
  supplier_id     TEXT REFERENCES suppliers(id),
  amount          REAL NOT NULL DEFAULT 0,
  due_date        TEXT,
  status          TEXT NOT NULL DEFAULT 'aberta',
  cost_center_id  TEXT REFERENCES cost_centers(id),
  approver_id     TEXT REFERENCES users(id),
  paid_at         TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_payables_company_due ON payables(company_id, due_date, status);

CREATE TABLE IF NOT EXISTS receivables (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id),
  customer_id     TEXT REFERENCES customers(id),
  ref_type        TEXT,
  ref_id          TEXT,
  amount          REAL NOT NULL DEFAULT 0,
  due_date        TEXT,
  status          TEXT NOT NULL DEFAULT 'aberta',
  received_at     TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_receivables_company_due ON receivables(company_id, due_date, status);

-- ----------------------------------------------------------------
-- DOCUMENTOS
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  title         TEXT NOT NULL,
  type          TEXT,
  file_path     TEXT NOT NULL,
  version       INTEGER DEFAULT 1,
  department_id TEXT REFERENCES departments(id),
  tags_json     TEXT DEFAULT '[]',
  entity_type   TEXT,
  entity_id     TEXT,
  uploaded_by   TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_documents_entity ON documents(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS attachments (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  file_path     TEXT NOT NULL,
  uploaded_by   TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments(entity_type, entity_id);

-- ----------------------------------------------------------------
-- TRANSVERSAIS
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activities (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id),
  entity_type     TEXT NOT NULL,
  entity_id       TEXT NOT NULL,
  action          TEXT NOT NULL,
  title           TEXT,
  description     TEXT,
  actor_id        TEXT REFERENCES users(id),
  target_user_id  TEXT REFERENCES users(id),
  old_value_json  TEXT,
  new_value_json  TEXT,
  metadata_json   TEXT,
  module          TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activities_entity ON activities(entity_type, entity_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activities_company ON activities(company_id, created_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  user_id       TEXT REFERENCES users(id),
  entity_type   TEXT NOT NULL,
  entity_id     TEXT,
  action        TEXT NOT NULL,
  before_json   TEXT,
  after_json    TEXT,
  ip            TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_company ON audit_logs(company_id, created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  type          TEXT,
  message       TEXT NOT NULL,
  ref_type      TEXT,
  ref_id        TEXT,
  is_read       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);

CREATE TABLE IF NOT EXISTS automation_rules (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id),
  name            TEXT NOT NULL,
  trigger_event   TEXT NOT NULL,
  conditions_json TEXT DEFAULT '{}',
  actions_json    TEXT DEFAULT '[]',
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_by      TEXT REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS approval_flows (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  module        TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  condition_json TEXT DEFAULT '{}',
  steps_json    TEXT DEFAULT '[]',
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS approvals (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  flow_id       TEXT REFERENCES approval_flows(id),
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  step          INTEGER NOT NULL DEFAULT 1,
  approver_id   TEXT REFERENCES users(id),
  status        TEXT NOT NULL DEFAULT 'pendente',
  comment       TEXT,
  decided_at    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_approvals_entity ON approvals(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS settings (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  key           TEXT NOT NULL,
  value_json    TEXT DEFAULT '{}',
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, key)
);

-- ============================================================
-- Fim da migration 0001_init
-- ============================================================
