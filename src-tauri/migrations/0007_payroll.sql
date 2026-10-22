-- Folha de pagamento: remuneração dos colaboradores.
-- Questão administrativo-financeira: visível só para CEO e Administração (recurso `payroll` do RBAC).
-- O RH (employees) e o Financeiro (payables/receivables) NÃO leem esta tabela.

CREATE TABLE IF NOT EXISTS employee_compensation (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id),
  employee_id     TEXT NOT NULL REFERENCES employees(id),
  base_salary     REAL NOT NULL DEFAULT 0,
  effective_from  TEXT,
  notes           TEXT,
  updated_by      TEXT REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT,
  UNIQUE (employee_id)
);
CREATE INDEX IF NOT EXISTS idx_employee_compensation_company ON employee_compensation(company_id);
