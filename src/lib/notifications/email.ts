// Fila de e-mails das notificações importantes (tabela email_outbox, 0014). O app não guarda senha de e-mail: em
// Configurações a pessoa abre cada aviso no app de e-mail dela (mailto com todos em Cco) e marca como enviado.
import type { DatabaseLike } from "@/lib/db/demo";

export const emailOutboxQueryKey = (companyId: string) => ["notifications", companyId, "email-outbox"] as const;

export interface EmailOutboxRow {
  id: string;
  company_id: string;
  notification_id?: string | null;
  to_email: string;
  subject: string;
  body: string;
  status: "pendente" | "enviado" | "cancelado";
  created_at: string;
  sent_at?: string | null;
}

/** Um aviso (mesmo assunto e texto) e todos os destinatários pendentes dele. */
export interface EmailGroup {
  subject: string;
  body: string;
  recipients: string[];
  ids: string[];
  created_at: string;
}

export async function pendingEmailGroups(db: DatabaseLike, companyId: string): Promise<EmailGroup[]> {
  const rows = await db.select<EmailOutboxRow[]>("SELECT * FROM email_outbox WHERE company_id=? AND status=?", [companyId, "pendente"]);
  const groups = new Map<string, EmailGroup>();
  for (const row of rows) {
    const key = `${row.subject}\u0000${row.body}`;
    const group = groups.get(key) ?? { subject: row.subject, body: row.body, recipients: [], ids: [], created_at: row.created_at };
    if (!group.recipients.includes(row.to_email)) group.recipients.push(row.to_email);
    group.ids.push(row.id);
    if (row.created_at < group.created_at) group.created_at = row.created_at;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** mailto: sem destinatário visível (todos em Cco), com assunto e texto. */
export function buildMailto(group: Pick<EmailGroup, "subject" | "body" | "recipients">): string {
  return `mailto:?bcc=${group.recipients.map(encodeURIComponent).join(",")}&subject=${encodeURIComponent(group.subject)}&body=${encodeURIComponent(group.body)}`;
}

async function setStatus(db: DatabaseLike, companyId: string, ids: readonly string[], status: EmailOutboxRow["status"]): Promise<void> {
  const now = new Date().toISOString();
  for (const id of ids) {
    await db.execute("UPDATE email_outbox SET status=?, sent_at=? WHERE company_id=? AND id=?", [status, status === "enviado" ? now : null, companyId, id]);
  }
}

export const markEmailsSent = (db: DatabaseLike, companyId: string, ids: readonly string[]) => setStatus(db, companyId, ids, "enviado");
export const discardEmails = (db: DatabaseLike, companyId: string, ids: readonly string[]) => setStatus(db, companyId, ids, "cancelado");
