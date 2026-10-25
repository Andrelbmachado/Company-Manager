-- Redesign modular (plano docs/superpowers/plans/2026-10-25-redesign-modular.md).
-- Tarefa 1: histórico do assistente. Tarefa 2: calendário, pastas de nuvem e campanhas de prospecção.
-- Fechada na Tarefa 2: a partir daqui ela não se edita (checksum no tauri-plugin-sql); schema novo vai para a 0013.
-- Convenções do 0001: IDs TEXT, timestamps ISO, company_id, soft delete. Migrations anteriores não se editam.
-- Valores de kind/provider ficam nos tipos de src/types/index.ts (sem CHECK, como no resto do schema).

-- Assistente de IA: conversas de cada pessoa, por empresa (a lista da sidebar mostra só as do próprio usuário).
-- created_at/updated_at são gravados pelo app em ISO com milissegundos (ordem estável das mensagens e da lista).
CREATE TABLE IF NOT EXISTS assistant_conversations (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL DEFAULT 'Nova conversa',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_assistant_conversations_user ON assistant_conversations(company_id, user_id, updated_at);

-- author: user | assistant (valores no tipo AssistantMessageAuthor, sem CHECK como no resto do schema).
CREATE TABLE IF NOT EXISTS assistant_messages (
  id               TEXT PRIMARY KEY,
  conversation_id  TEXT NOT NULL REFERENCES assistant_conversations(id),
  author           TEXT NOT NULL,
  text             TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assistant_messages_conversation ON assistant_messages(conversation_id, created_at);

-- Calendário: cada fonte é um link iCal (Google, Apple/iCloud, Outlook) ou a agenda local do app.
-- user_id = dono da agenda (filtro por funcionário; os eventos sincronizados herdam); NULL = agenda da empresa.
-- kind: ical | local. last_error guarda a última falha de sincronização (os eventos antigos ficam).
CREATE TABLE IF NOT EXISTS calendar_sources (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  user_id       TEXT REFERENCES users(id),
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'ical',
  url           TEXT,
  color         TEXT,
  last_sync_at  TEXT,
  last_error    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_calendar_sources_company ON calendar_sources(company_id, deleted_at);

-- Eventos: source_id NULL = criado no app. uid = chave da ocorrência na fonte (UID do iCal; numa recorrência
-- expandida, UID + início da ocorrência), única entre os eventos não excluídos da fonte: sincronizar de novo atualiza.
-- starts_at/ends_at: 'YYYY-MM-DD' no dia inteiro (all_day = 1, ends_at exclusivo como no iCal) ou instante ISO (UTC).
-- kind: ausencia | ferias | reuniao | externo | evento.
CREATE TABLE IF NOT EXISTS calendar_events (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES companies(id),
  source_id    TEXT REFERENCES calendar_sources(id),
  uid          TEXT,
  title        TEXT NOT NULL,
  starts_at    TEXT NOT NULL,
  ends_at      TEXT,
  all_day      INTEGER NOT NULL DEFAULT 0,
  location     TEXT,
  description  TEXT,
  user_id      TEXT REFERENCES users(id),
  kind         TEXT NOT NULL DEFAULT 'evento',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_calendar_events_period ON calendar_events(company_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_calendar_events_user ON calendar_events(company_id, user_id, starts_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_calendar_events_source_uid
  ON calendar_events(source_id, uid) WHERE source_id IS NOT NULL AND uid IS NOT NULL AND deleted_at IS NULL;

-- Pastas de nuvem conectadas (pasta sincronizada no Mac: iCloud Drive, Google Drive, OneDrive, Dropbox).
-- provider: icloud | gdrive | onedrive | dropbox | outro. A mesma pasta não entra duas vezes na empresa.
CREATE TABLE IF NOT EXISTS cloud_folders (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id),
  provider    TEXT NOT NULL DEFAULT 'outro',
  label       TEXT NOT NULL,
  local_path  TEXT NOT NULL,
  created_by  TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_cloud_folders_path ON cloud_folders(company_id, local_path) WHERE deleted_at IS NULL;

-- Prospecção com várias campanhas nomeadas. Leads são dados reais: nenhum seed, limpeza ou modo demo os apaga.
CREATE TABLE IF NOT EXISTS prospecting_campaigns (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id),
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_prospecting_campaigns_company ON prospecting_campaigns(company_id, deleted_at);

ALTER TABLE leads ADD COLUMN campaign_id TEXT REFERENCES prospecting_campaigns(id);
CREATE INDEX IF NOT EXISTS idx_leads_campaign ON leads(company_id, campaign_id);

-- Leads que já existiam (inclusive excluídos) vão para uma campanha "Prospecção 1" da empresa, renomeável.
-- Id determinístico 'prospeccao-1-<empresa>' (defaultCampaignId em src/lib/prospecting/campaigns.ts), fora dos
-- prefixos dev-/demo- que a limpeza do modo demonstração apaga.
INSERT OR IGNORE INTO prospecting_campaigns (id, company_id, name)
  SELECT DISTINCT 'prospeccao-1-' || company_id, company_id, 'Prospecção 1' FROM leads;
UPDATE leads SET campaign_id = 'prospeccao-1-' || company_id WHERE campaign_id IS NULL;
