-- Prospecção de sites: campos extras em leads, pacotes/preços, cenários e previsão de receita.
-- Convenções do 0001: IDs TEXT (UUID), timestamps ISO-8601, company_id, soft delete (deleted_at).
-- Valores de preço/previsão semeados pelo app são ESTIMATIVAS (is_estimate = 1).

CREATE TABLE IF NOT EXISTS service_packages (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  project_id    TEXT REFERENCES projects(id),
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  features_json TEXT DEFAULT '[]',
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_estimate   INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT,
  UNIQUE (company_id, code)
);
CREATE INDEX IF NOT EXISTS idx_service_packages_company ON service_packages(company_id);

CREATE TABLE IF NOT EXISTS package_prices (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  package_id    TEXT NOT NULL REFERENCES service_packages(id),
  segment       TEXT NOT NULL,
  setup_price   REAL NOT NULL DEFAULT 0,
  monthly_price REAL NOT NULL DEFAULT 0,
  is_estimate   INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT,
  UNIQUE (package_id, segment)
);
CREATE INDEX IF NOT EXISTS idx_package_prices_company ON package_prices(company_id, segment);

CREATE TABLE IF NOT EXISTS revenue_scenarios (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id),
  project_id      TEXT REFERENCES projects(id),
  code            TEXT NOT NULL,
  label           TEXT NOT NULL,
  conversion_rate REAL NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT,
  UNIQUE (company_id, project_id, code)
);

-- segment NULL = total geral do cenário. Id determinístico (cenário + segmento) evita duplicar.
CREATE TABLE IF NOT EXISTS revenue_forecasts (
  id                TEXT PRIMARY KEY,
  company_id        TEXT NOT NULL REFERENCES companies(id),
  project_id        TEXT REFERENCES projects(id),
  scenario_id       TEXT NOT NULL REFERENCES revenue_scenarios(id),
  segment           TEXT,
  leads_count       INTEGER NOT NULL DEFAULT 0,
  expected_closed   REAL NOT NULL DEFAULT 0,
  potential_setup   REAL NOT NULL DEFAULT 0,
  potential_monthly REAL NOT NULL DEFAULT 0,
  potential_revenue REAL NOT NULL DEFAULT 0,
  forecast_setup    REAL NOT NULL DEFAULT 0,
  forecast_monthly  REAL NOT NULL DEFAULT 0,
  forecast_revenue  REAL NOT NULL DEFAULT 0,
  is_estimate       INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_revenue_forecasts_scenario ON revenue_forecasts(company_id, scenario_id);

-- Leads: ALTER TABLE ADD COLUMN (SQLite não aceita NOT NULL sem DEFAULT nem FK com default não nulo).
ALTER TABLE leads ADD COLUMN project_id         TEXT REFERENCES projects(id);
ALTER TABLE leads ADD COLUMN category           TEXT;
ALTER TABLE leads ADD COLUMN business_type      TEXT;
ALTER TABLE leads ADD COLUMN whatsapp           TEXT;
ALTER TABLE leads ADD COLUMN google_rating      REAL;
ALTER TABLE leads ADD COLUMN google_reviews     INTEGER;
ALTER TABLE leads ADD COLUMN sem_site           INTEGER NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN online_presence    TEXT;
ALTER TABLE leads ADD COLUMN presence_kind      TEXT;
ALTER TABLE leads ADD COLUMN address            TEXT;
ALTER TABLE leads ADD COLUMN notes              TEXT;
ALTER TABLE leads ADD COLUMN source_url         TEXT;
ALTER TABLE leads ADD COLUMN package_id         TEXT REFERENCES service_packages(id);
ALTER TABLE leads ADD COLUMN estimated_setup    REAL NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN estimated_monthly  REAL NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN estimated_revenue  REAL NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN priority_rank      INTEGER;
ALTER TABLE leads ADD COLUMN outreach_day       INTEGER;
ALTER TABLE leads ADD COLUMN outreach_date      TEXT;
ALTER TABLE leads ADD COLUMN last_contact_at    TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_project_rank ON leads(project_id, priority_rank);
CREATE INDEX IF NOT EXISTS idx_leads_outreach ON leads(company_id, outreach_date);
