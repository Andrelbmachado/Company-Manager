-- Notificações do menu da conta (src/lib/notifications): comunicados do RH, decisões de solicitação e pendências novas
-- viram notificação para cada conta. Importante (`important` = 1) também entra na fila de e-mail (email_outbox), que o
-- app envia pelo app de e-mail da pessoa (Configurações).
ALTER TABLE notifications ADD COLUMN title TEXT;
ALTER TABLE notifications ADD COLUMN important INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notifications ADD COLUMN link TEXT;

ALTER TABLE hr_announcements ADD COLUMN important INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS email_outbox (
  id               TEXT PRIMARY KEY,
  company_id       TEXT NOT NULL REFERENCES companies(id),
  notification_id  TEXT REFERENCES notifications(id),
  to_email         TEXT NOT NULL,
  subject          TEXT NOT NULL,
  body             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pendente',
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_email_outbox_company ON email_outbox(company_id, status);
