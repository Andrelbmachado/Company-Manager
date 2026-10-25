-- Redesign modular (plano docs/superpowers/plans/2026-10-25-redesign-modular.md).
-- Versão ainda não lançada: a Tarefa 1 criou só o histórico do assistente; a Tarefa 2 acrescenta aqui calendário,
-- pastas de nuvem e campanhas de prospecção antes da primeira instalação com a 0012.
-- Convenções do 0001: IDs TEXT, timestamps ISO, company_id, soft delete. Migrations anteriores não se editam.

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
