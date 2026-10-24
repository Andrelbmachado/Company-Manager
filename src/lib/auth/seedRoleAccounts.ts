// Uma conta por setor (papel) para uma empresa nova: <papel>@<domínio>, todas com a mesma senha inicial e troca
// obrigatória no primeiro acesso. Idempotente: papel que já tem conta na empresa e e-mail já usado ficam de fora.
import { getDb } from "@/lib/db/client";
import { ROLE_LABELS } from "@/lib/permissions/rbac";
import { createUserAccount, emailInUse, type CreatedAccount } from "./accounts";
import { passwordProblem } from "./password";
import type { Role } from "@/types";

export const ROLE_ACCOUNT_DOMAIN = "empresa.local";
export const ALL_ROLES = Object.keys(ROLE_LABELS) as Role[];

export function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^@/, "");
}

export function isValidDomain(domain: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(domain);
}

export function roleAccountEmail(role: Role, domain = ROLE_ACCOUNT_DOMAIN): string {
  return `${role}@${normalizeDomain(domain)}`;
}

export async function seedRoleAccounts(
  companyId: string,
  defaultPassword: string,
  options: { domain?: string; roles?: Role[] } = {},
): Promise<CreatedAccount[]> {
  const domain = normalizeDomain(options.domain ?? ROLE_ACCOUNT_DOMAIN);
  if (!isValidDomain(domain)) throw new Error("Domínio dos e-mails inválido (exemplo: empresa.com.br).");
  const problem = passwordProblem(defaultPassword);
  if (problem) throw new Error(problem);

  const db = await getDb();
  // Filtro por papel em TypeScript: o banco demo só entende WHERE com "col=?" e "IS NULL".
  const members = await db.select<{ role: Role }[]>("SELECT * FROM memberships WHERE company_id = ? AND deleted_at IS NULL", [companyId]);
  const taken = new Set(members.map((member) => member.role));

  const created: CreatedAccount[] = [];
  for (const role of options.roles ?? ALL_ROLES) {
    const email = roleAccountEmail(role, domain);
    if (taken.has(role) || (await emailInUse(email))) continue;
    created.push(await createUserAccount({ companyId, name: ROLE_LABELS[role], email, password: defaultPassword, role, mustChangePassword: true }));
    taken.add(role);
  }
  return created;
}
