// Criação de contas (usuário + vínculo com a empresa). Usado no Setup, em Usuários e acessos e nas contas por setor.
import { v4 as uuidv4 } from "uuid";
import { getDb } from "@/lib/db/client";
import { hashPassword } from "./hash";
import { passwordProblem } from "./password";
import type { Role, Scope } from "@/types";

export interface NewAccount {
  companyId: string;
  name: string;
  email: string;
  password: string;
  role: Role;
  /** Pede a troca da senha no primeiro acesso. */
  mustChangePassword?: boolean;
}

export interface CreatedAccount {
  userId: string;
  membershipId: string;
  email: string;
  name: string;
  role: Role;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Diretoria, Administração e Gerência enxergam a empresa toda; os demais, o próprio setor. */
export function scopeForRole(role: Role): Scope {
  return role === "ceo" || role === "admin" || role === "gerente" ? "empresa" : "setor";
}

export async function emailInUse(email: string): Promise<boolean> {
  const db = await getDb();
  return (await db.select<unknown[]>("SELECT * FROM users WHERE lower(email) = ? AND deleted_at IS NULL LIMIT 1", [normalizeEmail(email)])).length > 0;
}

export async function createUserAccount(input: NewAccount): Promise<CreatedAccount> {
  const name = input.name.trim();
  const email = normalizeEmail(input.email);
  if (!name) throw new Error("Informe o nome da pessoa.");
  if (!isValidEmail(email)) throw new Error("E-mail inválido.");
  const problem = passwordProblem(input.password);
  if (problem) throw new Error(problem);
  if (await emailInUse(email)) throw new Error("Já existe uma conta com este e-mail.");

  const db = await getDb();
  const userId = uuidv4();
  const membershipId = uuidv4();
  // Colunas de 0001 no INSERT (o banco demo tem um tratador fixo para "insert into users"); a flag vai num UPDATE.
  await db.execute("INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)", [userId, name, email, await hashPassword(input.password)]);
  if (input.mustChangePassword) await db.execute("UPDATE users SET must_change_password=? WHERE id=?", [1, userId]);
  await db.execute("INSERT OR IGNORE INTO memberships (id, company_id, user_id, role, scope) VALUES (?, ?, ?, ?, ?)", [
    membershipId,
    input.companyId,
    userId,
    input.role,
    scopeForRole(input.role),
  ]);
  return { userId, membershipId, email, name, role: input.role };
}
