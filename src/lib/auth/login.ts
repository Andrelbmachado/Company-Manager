import { getDb } from "@/lib/db/client";
import { setSession, clearSession } from "./session";
import { hashPassword, verifyPassword } from "./hash";
import type { Session, Membership, Company, User } from "@/types";

export { hashPassword } from "./hash";

interface UserRow extends User {
  password_hash: string;
  password_algo?: string;
}

type DbLike = Awaited<ReturnType<typeof getDb>>;

const INVALID = "Credenciais inválidas";

/** O que vai para a sessão (sessionStorage): a conta sem nada da senha. */
function sessionUser(row: UserRow): User {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password_hash: _hash, password_algo: _algo, ...user } = row;
  return { ...user, must_change_password: Number(user.must_change_password ?? 0) };
}

export async function login(email: string, password: string): Promise<Session> {
  const db = await getDb();

  // E-mail não diferencia maiúsculas de minúsculas (contas antigas podem ter sido gravadas como digitadas).
  const [user] = await db.select<UserRow[]>("SELECT * FROM users WHERE lower(email) = ? AND deleted_at IS NULL LIMIT 1", [email.trim().toLowerCase()]);
  if (!user || !password) throw new Error(INVALID);

  const check = await verifyPassword(password, user.password_hash);
  if (!check.ok) throw new Error(INVALID);
  // Só depois da senha certa: quem não sabe a senha não descobre que a conta existe e está suspensa.
  if (user.status === "suspended") throw new Error("Conta suspensa. Fale com o CEO ou a Administração.");

  const [membership] = await db.select<Membership[]>("SELECT * FROM memberships WHERE user_id = ? AND deleted_at IS NULL LIMIT 1", [user.id]);
  if (!membership) throw new Error("Usuário sem empresa associada");

  const [company] = await db.select<Company[]>("SELECT * FROM companies WHERE id = ? AND deleted_at IS NULL LIMIT 1", [membership.company_id]);
  if (!company) throw new Error("Empresa não encontrada");

  if (check.needsRehash) await upgradeHash(db, user, password);
  await db.execute("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", [user.id]);

  const session: Session = { user: sessionUser(user), membership, company };
  setSession(session);
  return session;
}

/**
 * Senha certa num formato antigo ("plain:", PBKDF2 no desktop, argon2 fraco): regrava com o hash padrão.
 * Falha aqui não impede o login; o rehash fica para o próximo acesso.
 */
async function upgradeHash(db: DbLike, user: UserRow, password: string): Promise<void> {
  try {
    const next = await hashPassword(password);
    // A condição no hash antigo evita sobrescrever uma senha trocada por outra pessoa enquanto o hash era calculado.
    await db.execute("UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?", [next, user.id, user.password_hash]);
  } catch (error) {
    console.warn("[auth] não foi possível atualizar o hash da senha", error);
  }
}

/** A conta precisa trocar a senha antes de usar o app (senha inicial ou redefinida por outra pessoa). */
export function mustChangePassword(session: Session): boolean {
  return Number(session.user.must_change_password ?? 0) === 1;
}

/** Sessão depois que a própria pessoa trocou a senha (a troca obrigatória acabou). */
export function sessionAfterPasswordChange(session: Session): Session {
  const next: Session = { ...session, user: { ...session.user, must_change_password: 0 } };
  setSession(next);
  return next;
}

/**
 * Confere no banco se o acesso da sessão continua valendo. Papel rebaixado, conta removida ou suspensa e troca de senha
 * exigida passam a valer sem sair e entrar de novo.
 * Retorna a mesma sessão se nada mudou, uma sessão atualizada, ou null se o acesso acabou.
 */
export async function revalidateSession(session: Session): Promise<Session | null> {
  const db = await getDb();
  const [membership] = await db.select<Membership[]>("SELECT * FROM memberships WHERE id = ? AND deleted_at IS NULL LIMIT 1", [session.membership.id]);
  if (!membership) return null;
  const [user] = await db.select<UserRow[]>("SELECT * FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1", [session.user.id]);
  if (!user || user.status === "suspended") return null;
  const mustChange = Number(user.must_change_password ?? 0);
  if (membership.role === session.membership.role && membership.scope === session.membership.scope && mustChange === Number(session.user.must_change_password ?? 0)) {
    return session;
  }
  const next: Session = { ...session, membership, user: { ...session.user, must_change_password: mustChange } };
  setSession(next);
  return next;
}

export function logout(): void {
  clearSession();
}
