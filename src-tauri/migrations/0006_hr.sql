-- Recursos Humanos: colaboradores, solicitações (férias, folga, atestado), comunicados e pendências.
-- Convenções do 0001: IDs TEXT, timestamps ISO, company_id, soft delete.
-- Sem salário: remuneração fica fora do RH deste sistema (decisão: RH não vê "parte do salário").

CREATE TABLE IF NOT EXISTS employees (
  id                      TEXT PRIMARY KEY,
  company_id              TEXT NOT NULL REFERENCES companies(id),
  user_id                 TEXT REFERENCES users(id),
  name                    TEXT NOT NULL,
  email                   TEXT,
  department              TEXT,
  position                TEXT,
  hire_date               TEXT,
  vacation_days_entitled  INTEGER NOT NULL DEFAULT 30,
  status                  TEXT NOT NULL DEFAULT 'ativo',
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at              TEXT
);
CREATE INDEX IF NOT EXISTS idx_employees_company ON employees(company_id, status);
CREATE INDEX IF NOT EXISTS idx_employees_user ON employees(user_id);

CREATE TABLE IF NOT EXISTS hr_requests (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  employee_id   TEXT NOT NULL REFERENCES employees(id),
  type          TEXT NOT NULL DEFAULT 'ferias',
  start_date    TEXT NOT NULL,
  end_date      TEXT NOT NULL,
  days          INTEGER NOT NULL DEFAULT 1,
  reason        TEXT,
  status        TEXT NOT NULL DEFAULT 'pendente',
  decided_by    TEXT REFERENCES users(id),
  decided_at    TEXT,
  decision_note TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_hr_requests_employee ON hr_requests(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_hr_requests_company ON hr_requests(company_id, status);

CREATE TABLE IF NOT EXISTS hr_announcements (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'comunicado',
  pinned        INTEGER NOT NULL DEFAULT 0,
  published_by  TEXT REFERENCES users(id),
  published_at  TEXT NOT NULL DEFAULT (datetime('now')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_hr_announcements_company ON hr_announcements(company_id, published_at);

CREATE TABLE IF NOT EXISTS hr_tasks (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  employee_id   TEXT NOT NULL REFERENCES employees(id),
  title         TEXT NOT NULL,
  description   TEXT,
  due_date      TEXT,
  status        TEXT NOT NULL DEFAULT 'pendente',
  created_by    TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_hr_tasks_employee ON hr_tasks(employee_id, status);
