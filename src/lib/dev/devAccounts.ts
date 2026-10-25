// Contas de exemplo, uma por área (ids dev-user-<papel>, vínculos dev-member-<papel>). Os dados de exemplo
// (devSeed.ts e seeds/<area>.ts) pertencem a elas, então o modo demonstração (src/lib/demo) as cria antes de semear;
// o login rápido (quickLogin.ts) usa as mesmas contas para entrar. A limpeza do modo demonstração não as apaga.
import type { DatabaseLike } from "@/lib/db/demo";
import type { Role } from "@/types";
import { devUserId } from "./seedUtils";

export const DEV_AREAS: { role: Role; label: string; name: string }[] = [
  { role: "ceo", label: "CEO", name: "André Machado" },
  { role: "admin", label: "Admin", name: "Mariana Costa" },
  { role: "gerente", label: "Gerência", name: "Ricardo Almeida" },
  { role: "tecnico", label: "TI", name: "Lucas Ribeiro" },
  { role: "estoquista", label: "Estoque", name: "Patrícia Gomes" },
  { role: "financeiro", label: "Financeiro", name: "Fernanda Lima" },
  { role: "rh", label: "RH", name: "Tiago Freitas" },
  { role: "comercial", label: "Comercial", name: "Camila Martins" },
  { role: "atendimento", label: "Atendimento", name: "João Santos" },
  { role: "produtos", label: "Produtos", name: "Bruno Martins" },
  { role: "auditor", label: "Auditoria", name: "Beatriz Souza" },
];

export const devEmail = (role: Role) => `dev.${role}@company.local`;

/**
 * Senha que nenhum login aceita (formato desconhecido para verifyPassword). O modo demonstração cria as contas de
 * exemplo assim: os dados têm dono, mas ninguém entra com elas por senha. O login rápido troca pela senha dele.
 */
export const DISABLED_PASSWORD_HASH = "disabled:modo-demonstracao";

/**
 * Garante as contas de exemplo e os vínculos delas com a empresa. Conta que já existe (procurada pelo e-mail) mantém a
 * senha, a menos que esteja sem senha (DISABLED_PASSWORD_HASH) e `passwordHash` seja uma senha de verdade.
 */
export async function ensureDevAccounts(db: DatabaseLike, companyId: string, passwordHash: string): Promise<void> {
  for (const area of DEV_AREAS) {
    const email = devEmail(area.role);
    const [existing] = await db.select<{ id: string; password_hash: string }[]>(
      "SELECT id, password_hash FROM users WHERE lower(email) = ? AND deleted_at IS NULL LIMIT 1",
      [email],
    );
    let userId = existing?.id;
    if (!existing) {
      userId = devUserId(area.role);
      await db.execute("INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?,?,?,?)", [userId, area.name, email, passwordHash]);
    } else if (existing.password_hash === DISABLED_PASSWORD_HASH && passwordHash !== DISABLED_PASSWORD_HASH) {
      await db.execute("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ? AND password_hash = ?", [passwordHash, existing.id, DISABLED_PASSWORD_HASH]);
    }
    await db.execute(
      "INSERT OR IGNORE INTO memberships (id, company_id, user_id, role, scope) VALUES (?,?,?,?,?)",
      [`dev-member-${area.role}`, companyId, userId, area.role, ["ceo", "admin", "gerente"].includes(area.role) ? "empresa" : "setor"],
    );
  }
}
