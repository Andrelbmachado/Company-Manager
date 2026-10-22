-- Etapas do projeto (plano linear do Project Manager): concluídas, em andamento e a seguir.
-- Mesmas colunas de project_stages do app Project Manager (migration 0002), com FKs.
-- O status da etapa é derivado das tarefas quando elas existem; o valor gravado vale para etapas sem tarefas.

CREATE TABLE IF NOT EXISTS project_stages (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  project_id    TEXT NOT NULL REFERENCES projects(id),
  name          TEXT NOT NULL,
  description   TEXT,
  position      INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'a_seguir',
  start_date    TEXT,
  end_date      TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_project_stages_project ON project_stages(company_id, project_id, position);

ALTER TABLE tasks ADD COLUMN stage_id TEXT REFERENCES project_stages(id);
CREATE INDEX IF NOT EXISTS idx_tasks_stage ON tasks(stage_id);
