// Criação de contas (users + memberships). Usado pelo Setup, por Usuários e acessos e pelas contas por setor.
import { v4 as uuidv4 } from "uuid";
import { getDb } from "@/lib/db/client";
import { ROLE_LABELS } from "@/lib/permissions/rbac";
import type { Role, Scope } from "@/types";
import { hashPassword } from "./hash";
import { assertValidPassword } from "./password";

export interface NewUserAccount {
  companyId: string;
  name: string;
  email: string;
  password: string;
  role: Role;
  /** Pede a troca da senha no primeiro acesso (senha inicial definida por outra pessoa). */
  mustChangePassword?: boolean;
}

export interface CreatedAccount {
  userId: string;
  membershipId: string;
  role: Role;
  name: string;
  email: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email);
}

/** CEO, Administração e Gerência enxergam a empresa toda; os demais, o próprio setor. */
export function scopeForRole(role: Role): Scope {
  return role === "ceo" || role === "admin" || role === "gerente" ? "empresa" : "setor";
}

/** Mensagem de por que o e-mail não pode ser usado, ou null se está livre (e-mail sem diferença de caixa). */
export async function emailUnavailable(email: string): Promise<string | null> {
  const db = await getDb();
  const [row] = await db.select<{ id: string; deleted_at: string | null }[]>("SELECT id, deleted_at FROM users WHERE lower(email) = ? LIMIT 1", [normalizeEmail(email)]);
  if (!row) return null;
  // users.email é UNIQUE: nem uma conta removida libera o e-mail.
  return row.deleted_at ? "Este e-mail pertence a uma conta removida." : "Já existe uma conta com este e-mail.";
}

export async function emailInUse(email: string): Promise<boolean> {
  return (await emailUnavailable(email)) !== null;
}

export async function createUserAccount(input: NewUserAccount): Promise<CreatedAccount> {
  const name = input.name.trim();
  const email = normalizeEmail(input.email);
  if (!name) throw new Error("Informe o nome da pessoa.");
  if (!isValidEmail(email)) throw new Error("E-mail inválido.");
  if (!(input.role in ROLE_LABELS)) throw new Error("Papel inválido.");
  assertValidPassword(input.password);
  const unavailable = await emailUnavailable(email);
  if (unavailable) throw new Error(unavailable);
  return insertUserAccount({ ...input, name, email, passwordHash: await hashPassword(input.password) });
}

/** Grava a conta já validada, com o hash pronto (quem cria várias contas calcula os hashes em paralelo). */
export async function insertUserAccount(input: Omit<NewUserAccount, "password"> & { passwordHash: string }): Promise<CreatedAccount> {
  const db = await getDb();
  const userId = uuidv4();
  const membershipId = uuidv4();
  // O banco demo tem tratadores fixos para "insert into users" (só as colunas da 0001) e "insert into memberships"
  // (papel fixo): a flag vai num UPDATE e o vínculo pelo INSERT OR IGNORE, que cai no caminho genérico do demo.
  // O id é novo, então o OR IGNORE não esconde conflito no SQLite.
  await db.execute("INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)", [userId, input.name, input.email, input.passwordHash]);
  if (input.mustChangePassword) await db.execute("UPDATE users SET must_change_password = ? WHERE id = ?", [1, userId]);
  await db.execute("INSERT OR IGNORE INTO memberships (id, company_id, user_id, role, scope) VALUES (?, ?, ?, ?, ?)", [
    membershipId,
    input.companyId,
    userId,
    input.role,
    scopeForRole(input.role),
  ]);
  return { userId, membershipId, role: input.role, name: input.name, email: input.email };
}
