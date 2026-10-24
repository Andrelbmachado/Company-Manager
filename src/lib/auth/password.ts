// Troca e redefinição de senha. O hash vem de hash.ts (argon2id no desktop, PBKDF2 no navegador);
// a coluna users.password_algo é mantida por gatilhos do SQLite (migration 0010), o app não a grava.
import { getDb } from "@/lib/db/client";
import { hashPassword, verifyPassword } from "./hash";

export const PASSWORD_MIN_LENGTH = 6;

/** Motivo para recusar a senha, ou null se ela serve. */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `A senha precisa ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  if (!password.trim()) return "A senha não pode ser só espaços.";
  return null;
}

export function assertValidPassword(password: string): void {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
}

interface PasswordRow {
  password_hash: string;
}

async function storedHash(userId: string): Promise<string> {
  const db = await getDb();
  const [row] = await db.select<PasswordRow[]>("SELECT password_hash FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1", [userId]);
  if (!row) throw new Error("Conta não encontrada.");
  return row.password_hash;
}

/**
 * A própria pessoa troca a senha. Com `currentPassword`, confere a atual antes (troca voluntária, em Configurações);
 * sem ela, é a troca obrigatória logo depois do login. Em qualquer caso a troca obrigatória deixa de valer.
 */
export async function changePassword(userId: string, newPassword: string, options: { currentPassword?: string } = {}): Promise<void> {
  const current = await storedHash(userId);
  if (options.currentPassword !== undefined && !(await verifyPassword(options.currentPassword, current)).ok) {
    throw new Error("A senha atual não confere.");
  }
  assertValidPassword(newPassword);
  if ((await verifyPassword(newPassword, current)).ok) throw new Error("A nova senha precisa ser diferente da atual.");
  const hash = await hashPassword(newPassword);
  await (await getDb()).execute(
    "UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    [hash, userId],
  );
}

/** CEO/Administração define uma senha nova para alguém; por padrão a pessoa troca no próximo acesso. */
export async function resetUserPassword(userId: string, newPassword: string, options: { mustChange?: boolean } = {}): Promise<void> {
  assertValidPassword(newPassword);
  await storedHash(userId);
  const hash = await hashPassword(newPassword);
  await (await getDb()).execute(
    "UPDATE users SET password_hash = ?, must_change_password = ?, password_changed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    [hash, options.mustChange === false ? 0 : 1, userId],
  );
}

/** Liga ou desliga a troca de senha obrigatória no próximo acesso (vale também para sessões abertas, ver revalidateSession). */
export async function setPasswordChangeRequired(userId: string, required: boolean): Promise<void> {
  await storedHash(userId);
  await (await getDb()).execute("UPDATE users SET must_change_password = ?, updated_at = datetime('now') WHERE id = ?", [required ? 1 : 0, userId]);
}

/**
 * Contas antigas guardam a senha em texto ("plain:<senha>"). Como a senha está ali, dá para trocar pelo hash
 * sem esperar o próximo login de cada pessoa: a senha continua a mesma, só deixa de ficar legível no banco.
 * Inclui contas removidas. Devolve quantas foram convertidas. Só no SQLite real (o demo não entende a consulta).
 */
export async function upgradeLegacyPasswords(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ id: string; password_hash: string }[]>(
    "SELECT id, password_hash FROM users WHERE substr(password_hash, 1, 6) = 'plain:' AND length(password_hash) > 6",
  );
  let upgraded = 0;
  for (const row of rows) {
    const hash = await hashPassword(row.password_hash.slice("plain:".length));
    // Só troca se ninguém mexeu na senha enquanto o hash era calculado.
    const result = (await db.execute("UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?", [hash, row.id, row.password_hash])) as { rowsAffected?: number } | undefined;
    if ((result?.rowsAffected ?? 1) > 0) upgraded++;
  }
  return upgraded;
}
