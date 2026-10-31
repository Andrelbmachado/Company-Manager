// Notificações do menu da conta (AccountMenu → Notificações). Comunicados do RH, decisões de solicitação e pendências
// novas gravam uma notificação por conta na tabela `notifications` (0001 + 0014); as importantes também entram na fila
// de e-mail `email_outbox`, enviada pelo app de e-mail da pessoa (Configurações). SQL nos padrões do banco demo.
import { v4 as uuidv4 } from "uuid";
import type { DatabaseLike } from "@/lib/db/demo";
import { isDemoId } from "@/lib/demo/purge";
import { isDemoMode } from "@/lib/demo/state";
import type { Notification } from "@/types";

export const notificationsQueryKey = (companyId: string, userId: string) => ["notifications", companyId, userId] as const;

export interface NotifyInput {
  userIds: readonly string[];
  type: string;
  title: string;
  message: string;
  /** Tela que a notificação abre (ex.: /hr). */
  link?: string | null;
  important?: boolean;
  refType?: string | null;
  refId?: string | null;
  /**
   * Prefixo do id (os dados de exemplo usam "dev-" para a limpeza do modo demonstração achar). Aviso sobre um registro
   * de exemplo (`refId` dev-/demo-) ou para uma conta de exemplo já ganha "dev-" sozinho.
   */
  idPrefix?: string;
}

interface UserRow {
  id: string;
  email?: string | null;
  status?: string | null;
}

/** Grava uma notificação por conta (sem repetir conta); importantes também vão para a fila de e-mail. Devolve os ids. */
export async function notifyUsers(db: DatabaseLike, companyId: string, input: NotifyInput): Promise<string[]> {
  const ids: string[] = [];
  const now = new Date().toISOString();
  for (const userId of new Set(input.userIds)) {
    const example = isDemoId(input.refId) || isDemoId(userId);
    const prefix = input.idPrefix ?? (example ? "dev-" : "");
    const id = `${prefix}${uuidv4()}`;
    await db.execute(
      "INSERT INTO notifications (id, company_id, user_id, type, title, message, link, important, ref_type, ref_id, is_read, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [id, companyId, userId, input.type, input.title, input.message, input.link ?? null, input.important ? 1 : 0, input.refType ?? null, input.refId ?? null, 0, now],
    );
    ids.push(id);
    // Contas de exemplo (dev.<papel>@company.local) não recebem e-mail.
    if (!input.important || isDemoId(userId)) continue;
    const [user] = await db.select<UserRow[]>("SELECT * FROM users WHERE id=?", [userId]);
    const email = user?.email?.trim();
    if (!email) continue;
    await db.execute("INSERT INTO email_outbox (id, company_id, notification_id, to_email, subject, body, status, created_at) VALUES (?,?,?,?,?,?,?,?)", [
      `${prefix}${uuidv4()}`,
      companyId,
      id,
      email,
      input.title,
      input.message,
      "pendente",
      now,
    ]);
  }
  return ids;
}

/** Contas ativas da empresa (vínculos não removidos, conta não suspensa); as de exemplo só com o modo demonstração ligado. */
export async function companyUserIds(db: DatabaseLike, companyId: string): Promise<string[]> {
  const withExamples = await isDemoMode(db, companyId);
  const memberships = await db.select<{ user_id: string; deleted_at?: string | null }[]>("SELECT * FROM memberships WHERE company_id=?", [companyId]);
  const ids: string[] = [];
  for (const membership of memberships) {
    if (membership.deleted_at || !membership.user_id) continue;
    if (!withExamples && isDemoId(membership.user_id)) continue;
    const [user] = await db.select<UserRow[]>("SELECT * FROM users WHERE id=?", [membership.user_id]);
    if (user && user.status !== "suspended") ids.push(user.id);
  }
  return ids;
}

/** Comunicado do RH publicado: notifica todo mundo da empresa (importante também por e-mail). */
export async function notifyAnnouncement(
  db: DatabaseLike,
  companyId: string,
  announcement: { id: string; title: string; body: string; important?: number | boolean | null },
  idPrefix?: string,
): Promise<string[]> {
  return notifyUsers(db, companyId, {
    userIds: await companyUserIds(db, companyId),
    type: "hr_announcement",
    title: announcement.title,
    message: announcement.body,
    link: "/hr",
    important: !!Number(announcement.important ?? 0),
    refType: "hr_announcement",
    refId: announcement.id,
    idPrefix,
  });
}

/** Aviso para colaboradores (pela conta ligada ao cadastro); quem não tem conta no app fica de fora. */
export async function notifyEmployees(
  db: DatabaseLike,
  companyId: string,
  employeeIds: readonly string[],
  input: Omit<NotifyInput, "userIds">,
): Promise<string[]> {
  const userIds: string[] = [];
  for (const employeeId of employeeIds) {
    const [employee] = await db.select<{ user_id?: string | null }[]>("SELECT * FROM employees WHERE company_id=? AND id=?", [companyId, employeeId]);
    if (employee?.user_id) userIds.push(employee.user_id);
  }
  return notifyUsers(db, companyId, { link: "/hr", ...input, userIds });
}

/** Últimas notificações da pessoa, mais novas primeiro. */
export async function listNotifications(db: DatabaseLike, companyId: string, userId: string, limit = 20): Promise<Notification[]> {
  const rows = await db.select<Notification[]>("SELECT * FROM notifications WHERE company_id=? AND user_id=?", [companyId, userId]);
  return [...rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, limit);
}

export async function unreadCount(db: DatabaseLike, companyId: string, userId: string): Promise<number> {
  const rows = await db.select<Notification[]>("SELECT * FROM notifications WHERE company_id=? AND user_id=? AND is_read=?", [companyId, userId, 0]);
  return rows.length;
}

/** Marca uma notificação (ou, sem id, todas) da pessoa como lida. */
export async function markRead(db: DatabaseLike, companyId: string, userId: string, id?: string): Promise<void> {
  if (id) await db.execute("UPDATE notifications SET is_read=? WHERE company_id=? AND user_id=? AND id=?", [1, companyId, userId, id]);
  else await db.execute("UPDATE notifications SET is_read=? WHERE company_id=? AND user_id=? AND is_read=?", [1, companyId, userId, 0]);
}
