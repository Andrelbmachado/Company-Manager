import { getDb } from "@/lib/db/client";
import { setSession, clearSession } from "./session";
import { hashPassword, verifyPassword } from "./hash";
import type { Session, Membership, Company } from "@/types";

export { hashPassword } from "./hash";

interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  avatar_path?: string | null;
  status: "active" | "suspended";
  locale: string;
  last_login_at?: string | null;
  must_change_password?: number | null;
  password_changed_at?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

/** 0/1 do SQLite; ausente nas linhas do banco demo antigo. */
function flag(value: unknown): number {
  return Number(value) === 1 ? 1 : 0;
}

export async function login(email: string, password: string): Promise<Session> {
  const db = await getDb();

  // E-mail não diferencia maiúsculas de minúsculas (contas antigas podem ter sido gravadas como digitadas).
  const users = await db.select<UserRow[]>(
    "SELECT * FROM users WHERE lower(email) = ? AND deleted_at IS NULL LIMIT 1",
    [email.trim().toLowerCase()]
  );

  if (!users.length) throw new Error("Credenciais inválidas");
  const user = users[0];

  const check = await verifyPassword(password, user.password_hash);
  if (!check.ok) throw new Error("Credenciais inválidas");
  if (user.status === "suspended") throw new Error("Conta suspensa. Fale com o CEO ou a Administração da empresa.");

  if (check.needsRehash) {
    // Senha legada ("plain:") ou hash fraco: regrava no formato atual. Falhar aqui não pode impedir a entrada.
    try {
      await db.execute("UPDATE users SET password_hash=? WHERE id=?", [await hashPassword(password), user.id]);
    } catch (error) {
      console.warn("[auth] não foi possível atualizar o hash da senha; fica para o próximo login", error);
    }
  }

  const memberships = await db.select<Membership[]>(
    "SELECT * FROM memberships WHERE user_id = ? AND deleted_at IS NULL LIMIT 1",
    [user.id]
  );
  if (!memberships.length) throw new Error("Usuário sem empresa associada");
  const membership = memberships[0];

  const companies = await db.select<Company[]>(
    "SELECT * FROM companies WHERE id = ? AND deleted_at IS NULL LIMIT 1",
    [membership.company_id]
  );
  if (!companies.length) throw new Error("Empresa não encontrada");
  const company = companies[0];

  await db.execute("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", [user.id]);

  const { password_hash: _ph, ...safeUser } = user;
  const session: Session = { user: { ...safeUser, must_change_password: flag(user.must_change_password) } as Session["user"], membership, company };
  setSession(session);
  return session;
}

/** A conta precisa trocar a senha antes de usar o sistema (primeiro acesso ou pedido do CEO/Administração). */
export function mustChangePassword(session: Session): boolean {
  return flag(session.user.must_change_password) === 1;
}

/** Sessão depois que a própria pessoa trocou a senha (a troca obrigatória acabou). */
export function sessionAfterPasswordChange(session: Session): Session {
  const next: Session = { ...session, user: { ...session.user, must_change_password: 0 } };
  setSession(next);
  return next;
}

/**
 * Confere no banco se o acesso da sessão continua valendo. Papel rebaixado, conta removida ou troca de senha exigida
 * passam a valer sem sair e entrar de novo.
 * Retorna a mesma sessão se nada mudou, uma sessão atualizada, ou null se o acesso acabou.
 */
export async function revalidateSession(session: Session): Promise<Session | null> {
  const db = await getDb();
  const [membership] = await db.select<Membership[]>("SELECT * FROM memberships WHERE id = ? AND deleted_at IS NULL LIMIT 1", [session.membership.id]);
  if (!membership) return null;
  const [user] = await db.select<UserRow[]>("SELECT * FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1", [session.user.id]);
  if (!user || user.status === "suspended") return null;
  const mustChange = flag(user.must_change_password);
  const sameAccess = membership.role === session.membership.role && membership.scope === session.membership.scope;
  if (sameAccess && mustChange === flag(session.user.must_change_password)) return session;
  const next: Session = { ...session, membership, user: { ...session.user, must_change_password: mustChange } };
  setSession(next);
  return next;
}

export function logout(): void {
  clearSession();
}
