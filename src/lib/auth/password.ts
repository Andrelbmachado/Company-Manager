// Troca, redefinição e troca obrigatória de senha (users.must_change_password, migration 0010).
// SQL simples (UPDATE ... WHERE id=?, SELECT * ... WHERE id=?) para rodar igual no SQLite e no banco demo.
import { getDb } from "@/lib/db/client";
import { hashPassword, verifyPassword } from "./hash";

export const PASSWORD_MIN_LENGTH = 6;

/** Problema da senha nova, em pt-BR, ou null se ela serve. */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `A senha precisa ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  if (!password.trim()) return "A senha não pode ser só espaços.";
  return null;
}

function assertPassword(password: string): void {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
}

async function storedHash(userId: string): Promise<string> {
  const db = await getDb();
  const [user] = await db.select<{ password_hash: string }[]>("SELECT * FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1", [userId]);
  if (!user) throw new Error("Conta não encontrada.");
  return user.password_hash;
}

/**
 * A própria pessoa troca a senha. Com `currentPassword` (Configurações) a senha atual é conferida; sem ela é a troca
 * obrigatória logo depois do login, que acabou de conferir a senha. Em ambos os casos a troca obrigatória acaba.
 */
export async function changePassword(userId: string, newPassword: string, options: { currentPassword?: string } = {}): Promise<void> {
  const current = await storedHash(userId);
  if (options.currentPassword !== undefined && !(await verifyPassword(options.currentPassword, current)).ok) {
    throw new Error("A senha atual não confere.");
  }
  assertPassword(newPassword);
  if ((await verifyPassword(newPassword, current)).ok) throw new Error("A nova senha precisa ser diferente da atual.");
  await (await getDb()).execute(
    "UPDATE users SET password_hash=?, must_change_password=0, password_changed_at=datetime('now'), updated_at=datetime('now') WHERE id=?",
    [await hashPassword(newPassword), userId],
  );
}

/** CEO/Administração define uma senha nova para alguém; por padrão a pessoa troca no próximo acesso. */
export async function resetUserPassword(userId: string, newPassword: string, options: { mustChange?: boolean } = {}): Promise<void> {
  assertPassword(newPassword);
  await storedHash(userId);
  await (await getDb()).execute(
    "UPDATE users SET password_hash=?, must_change_password=?, password_changed_at=datetime('now'), updated_at=datetime('now') WHERE id=?",
    [await hashPassword(newPassword), options.mustChange === false ? 0 : 1, userId],
  );
}

/** Liga ou desliga a troca obrigatória sem mudar a senha (a pessoa entra com a senha atual e escolhe outra). */
export async function setPasswordChangeRequired(userId: string, required: boolean): Promise<void> {
  await storedHash(userId);
  await (await getDb()).execute("UPDATE users SET must_change_password=?, updated_at=datetime('now') WHERE id=?", [required ? 1 : 0, userId]);
}
