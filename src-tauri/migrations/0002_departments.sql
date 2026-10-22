-- 0002: Departamentos, vínculo usuário↔departamento, grants cruzados e férias/ausências.
-- SQLite não tem RLS; o isolamento é garantido por (1) camada de dados com
-- assertCanDepartment e (2) VIEW limitada para dados compartilhados.

ALTER TABLE departments ADD COLUMN slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_departments_company_slug ON departments(company_id, slug);

CREATE TABLE IF NOT EXISTS department_members (
  id            TEXT PRIMARY KEY,
  department_id TEXT NOT NULL REFERENCES departments(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  role          TEXT NOT NULL DEFAULT 'membro' CHECK (role IN ('chefe','assistente','membro')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT,
  UNIQUE (department_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_department_members_user ON department_members(user_id);

-- Espelho da configuração CROSS_DEPARTMENT_GRANTS (src/lib/departments/access.ts).
CREATE TABLE IF NOT EXISTS department_grants (
  grantee_slug TEXT NOT NULL,
  owner_slug   TEXT NOT NULL,
  resource     TEXT NOT NULL,
  fields       TEXT,
  PRIMARY KEY (grantee_slug, owner_slug, resource)
);
INSERT OR IGNORE INTO department_grants VALUES
  ('marketing', 'rh', 'ferias_ausencias', 'colaborador_nome,tipo,data_inicio,data_fim');

CREATE TABLE IF NOT EXISTS hr_absences (
  id               TEXT PRIMARY KEY,
  company_id       TEXT NOT NULL REFERENCES companies(id),
  user_id          TEXT REFERENCES users(id),
  colaborador_nome TEXT NOT NULL,
  tipo             TEXT NOT NULL DEFAULT 'ferias',
  data_inicio      TEXT NOT NULL,
  data_fim         TEXT NOT NULL,
  motivo           TEXT,
  status           TEXT NOT NULL DEFAULT 'aprovado',
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at       TEXT
);

-- Projeção limitada para outros departamentos: sem motivo, sem status interno.
CREATE VIEW IF NOT EXISTS v_rh_ferias_ausencias_compartilhado AS
  SELECT company_id, colaborador_nome, tipo, data_inicio, data_fim
    FROM hr_absences
   WHERE deleted_at IS NULL AND status = 'aprovado';

-- Cria os 20 departamentos para cada empresa existente.
WITH catalog(slug, name) AS (VALUES
  ('design', 'Design'),
  ('rh', 'RH'),
  ('financeiro', 'Financeiro'),
  ('projetos', 'Projetos'),
  ('ti', 'TI'),
  ('vendas', 'Vendas'),
  ('suporte', 'Suporte'),
  ('operacoes', 'Operações'),
  ('marketing', 'Marketing'),
  ('comercial', 'Comercial'),
  ('compras', 'Compras'),
  ('logistica', 'Logística'),
  ('qualidade', 'Qualidade'),
  ('pmo', 'PMO'),
  ('seguranca-informacao', 'Segurança da Informação'),
  ('contabilidade', 'Contabilidade'),
  ('administrativo', 'Administrativo'),
  ('atendimento-cliente', 'Atendimento ao Cliente'),
  ('dados-analytics', 'Dados e Analytics'),
  ('assistente-executivo', 'Assistente Executivo')
)
INSERT OR IGNORE INTO departments (id, company_id, name, slug)
SELECT lower(hex(randomblob(16))), c.id, catalog.name, catalog.slug
  FROM companies c CROSS JOIN catalog
 WHERE c.deleted_at IS NULL;
