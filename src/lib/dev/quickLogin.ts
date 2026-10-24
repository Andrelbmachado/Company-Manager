// TEMPORÁRIO (login rápido de desenvolvimento). Para remover: apague a pasta src/lib/dev, o componente
// src/components/dev/DevQuickLogin.tsx e o uso dele em LoginPage.tsx. Ou ponha DEV_QUICK_LOGIN = false.
import { getDb, isTauriRuntime } from "@/lib/db/client";
import { DEMO_ACCOUNTS } from "@/lib/db/demo";
import { hashPassword, login } from "@/lib/auth/login";
import { devUserId, seedDevData } from "./devSeed";
import type { Role, Session } from "@/types";

export const DEV_QUICK_LOGIN = true;
export const DEV_PASSWORD = "dev";

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

/** Garante empresa, uma conta por área e os dados de exemplo (desktop); no navegador usa as contas demo. */
export async function devQuickLogin(role: Role): Promise<Session> {
  if (!isTauriRuntime()) {
    const account = DEMO_ACCOUNTS.find((item) => item.role === role);
    if (!account) throw new Error("Área sem conta demo.");
    return login(account.email, account.password);
  }

  const db = await getDb();
  let [company] = await db.select<{ id: string }[]>("SELECT id FROM companies WHERE deleted_at IS NULL ORDER BY created_at ASC LIMIT 1");
  if (!company) {
    company = { id: "dev-company" };
    await db.execute("INSERT OR IGNORE INTO companies (id, name) VALUES (?, ?)", [company.id, "Minha Empresa"]);
  }

  const hash = await hashPassword(DEV_PASSWORD);
  for (const area of DEV_AREAS) {
    const email = devEmail(area.role);
    const exists = await db.select<{ id: string }[]>("SELECT id FROM users WHERE lower(email) = ? AND deleted_at IS NULL LIMIT 1", [email]);
    if (exists.length) continue;
    const userId = devUserId(area.role);
    await db.execute("INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?,?,?,?)", [userId, area.name, email, hash]);
    await db.execute(
      "INSERT OR IGNORE INTO memberships (id, company_id, user_id, role, scope) VALUES (?,?,?,?,?)",
      [`dev-member-${area.role}`, company.id, userId, area.role, ["ceo", "admin", "gerente"].includes(area.role) ? "empresa" : "setor"],
    );
  }

  await seedDevData(company.id);
  return login(devEmail(role), DEV_PASSWORD);
}
