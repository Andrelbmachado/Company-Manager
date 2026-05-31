import { getDb } from "@/lib/db/client";
import { setSession, clearSession } from "./session";
import type { Session, Membership, Company } from "@/types";

interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  avatar_path?: string | null;
  status: "active" | "suspended";
  locale: string;
  last_login_at?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export async function login(email: string, password: string): Promise<Session> {
  const db = await getDb();

  const users = await db.select<UserRow[]>(
    "SELECT * FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1",
    [email]
  );

  if (!users.length) throw new Error("Credenciais inválidas");
  const user = users[0];

  // In production, use Argon2 via Tauri command. For V1, we do plain comparison
  // TODO: replace with tauri command for argon2 verify
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) throw new Error("Credenciais inválidas");

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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password_hash: _ph, ...safeUser } = user;
  const session: Session = { user: safeUser as Session["user"], membership, company };
  setSession(session);
  return session;
}

export function logout(): void {
  clearSession();
}

// Simplified password check for V1. Argon2 verify via Rust command in V1.5.
async function verifyPassword(password: string, hash: string): Promise<boolean> {
  // Hash stored as "plain:<password>" in setup wizard for initial accounts
  if (hash.startsWith("plain:")) {
    return hash.slice(6) === password;
  }
  return false;
}

export async function hashPassword(password: string): Promise<string> {
  // Stored as plain prefix for V1 bootstrap; replace with tauri argon2 command in V1.5
  return `plain:${password}`;
}
