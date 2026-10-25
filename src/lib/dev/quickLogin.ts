// TEMPORÁRIO (login rápido de desenvolvimento). Para remover: ponha DEV_QUICK_LOGIN = false, ou apague este arquivo,
// o componente src/components/dev/DevQuickLogin.tsx e o uso dele em LoginPage.tsx. Os dados de exemplo
// (devSeed.ts, seeds/) e as contas de exemplo (devAccounts.ts) ficam: são do modo demonstração (src/lib/demo).
import { getDb, isTauriRuntime } from "@/lib/db/client";
import { DEMO_ACCOUNTS } from "@/lib/db/demo";
import { hashPassword, login } from "@/lib/auth/login";
import { devEmail, ensureDevAccounts } from "./devAccounts";
import { runAreaSeeds } from "./seeds";
import type { Role, Session } from "@/types";

export { DEV_AREAS, devEmail } from "./devAccounts";

export const DEV_QUICK_LOGIN = true;
export const DEV_PASSWORD = "dev";

/**
 * Desktop: garante empresa e uma conta por área e entra; **não grava dados de exemplo** (eles só entram pelo modo
 * demonstração, em Configurações). Navegador: entra com a conta demo; o banco demo é todo de demonstração, então os
 * seeds de área continuam completando-o (catálogo, vendas, financeiro...).
 */
export async function devQuickLogin(role: Role): Promise<Session> {
  if (!isTauriRuntime()) {
    const account = DEMO_ACCOUNTS.find((item) => item.role === role);
    if (!account) throw new Error("Área sem conta demo.");
    const session = await login(account.email, account.password);
    // Falha num seed de área não impede o login (o erro volta no resultado e no console).
    await runAreaSeeds(session.company.id);
    return session;
  }

  const db = await getDb();
  let [company] = await db.select<{ id: string }[]>("SELECT id FROM companies WHERE deleted_at IS NULL ORDER BY created_at ASC LIMIT 1");
  if (!company) {
    company = { id: "dev-company" };
    await db.execute("INSERT OR IGNORE INTO companies (id, name) VALUES (?, ?)", [company.id, "Minha Empresa"]);
  }

  await ensureDevAccounts(db, company.id, await hashPassword(DEV_PASSWORD));
  return login(devEmail(role), DEV_PASSWORD);
}
