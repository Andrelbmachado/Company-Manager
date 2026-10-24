// Uma conta por setor (papel) para uma empresa nova: <papel>@<domínio>, senha inicial única e troca obrigatória
// no primeiro acesso. Idempotente: papel que já tem conta na empresa e e-mail já usado ficam de fora.
import { getDb } from "@/lib/db/client";
import { ROLE_LABELS } from "@/lib/permissions/rbac";
import type { Role } from "@/types";
import { emailUnavailable, insertUserAccount, type CreatedAccount } from "./accounts";
import { hashPassword } from "./hash";
import { assertValidPassword } from "./password";

export const ROLE_ACCOUNT_DOMAIN = "empresa.local";
export const ALL_ROLES = Object.keys(ROLE_LABELS) as Role[];

export type Account = CreatedAccount;

export function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^@/, "");
}

/** Rótulos de letras, números e hífen separados por ponto (empresa.local, loja.com.br). */
export function isValidDomain(domain: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(domain);
}

export function roleAccountEmail(role: Role, domain = ROLE_ACCOUNT_DOMAIN): string {
  return `${role}@${normalizeDomain(domain)}`;
}

export interface SeedRoleAccountsOptions {
  /** Domínio dos e-mails (padrão empresa.local). */
  domain?: string;
  /** Papéis a criar (padrão: os 11). */
  roles?: Role[];
}

export async function seedRoleAccounts(companyId: string, defaultPassword: string, options: SeedRoleAccountsOptions = {}): Promise<Account[]> {
  assertValidPassword(defaultPassword);
  const domain = normalizeDomain(options.domain ?? ROLE_ACCOUNT_DOMAIN);
  if (!isValidDomain(domain)) throw new Error("Domínio dos e-mails inválido (exemplo: empresa.local ou suaempresa.com.br).");

  const db = await getDb();
  // Filtro por papel no TypeScript: o banco demo só entende WHERE com "col = ?" e "IS NULL".
  const members = await db.select<{ role: Role }[]>("SELECT * FROM memberships WHERE company_id = ? AND deleted_at IS NULL", [companyId]);
  const taken = new Set(members.map((member) => member.role));
  const pending: Omit<Account, "userId" | "membershipId">[] = [];
  for (const role of options.roles ?? ALL_ROLES) {
    if (!(role in ROLE_LABELS) || taken.has(role)) continue;
    const email = roleAccountEmail(role, domain);
    if (await emailUnavailable(email)) continue;
    pending.push({ role, name: ROLE_LABELS[role], email });
    taken.add(role);
  }

  // Um hash por conta (sal próprio), calculados em paralelo; as gravações seguem uma a uma.
  const hashes = await Promise.all(pending.map(() => hashPassword(defaultPassword)));
  const created: Account[] = [];
  for (const [index, account] of pending.entries()) {
    created.push(await insertUserAccount({ companyId, ...account, passwordHash: hashes[index], mustChangePassword: true }));
  }
  return created;
}
