// Contas da empresa editadas direto na tabela (Configurações > Usuários e acessos). Regras conferidas aqui, não só
// na tela: criar exige `create` em `users`, alterar exige `edit`; só o CEO concede, retira ou mexe numa conta de CEO;
// ninguém muda o próprio papel nem exige troca da própria senha. Conta nova recebe uma senha temporária gerada
// aqui (a tabela não tem campo de senha): a tela mostra a senha uma vez para quem criou passar à pessoa.
import { getDb } from "@/lib/db/client";
import { createUserAccount, emailUnavailable, isValidEmail, normalizeEmail, scopeForRole } from "@/lib/auth/accounts";
import { PASSWORD_MIN_LENGTH, resetUserPassword, setPasswordChangeRequired } from "@/lib/auth/password";
import { emit } from "@/lib/events/bus";
import { can, ROLE_LABELS } from "@/lib/permissions/rbac";
import type { Membership, Role, User } from "@/types";

export interface UserAccessRow {
  /** id do usuário. */
  id: string;
  membership_id: string;
  name: string;
  email: string;
  role: Role;
  /** 1 = escolhe uma senha nova no próximo acesso. */
  must_change_password: number;
  status: string;
}

export type UserAccessFields = Partial<Pick<UserAccessRow, "name" | "email" | "role" | "must_change_password">> & { must_change_password?: number | boolean };

export interface UserAccessChanges {
  updated: (UserAccessFields & { id: string })[];
  created: UserAccessFields[];
}

export interface UsersActor {
  role: Role;
  userId: string;
}

export interface CreatedLogin {
  userId: string;
  name: string;
  email: string;
  /** Senha temporária gerada: mostrada uma vez, não fica guardada em texto. */
  password: string;
  mustChange: boolean;
}

const ROLES = new Set(Object.keys(ROLE_LABELS));
// Sem caracteres que se confundem ao ditar ou copiar (0/O, 1/l/I).
const PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const isOn = (value: unknown) => value === true || value === 1 || value === "1" || value === "true";

/** Senha temporária aleatória (10 caracteres, acima do mínimo de PASSWORD_MIN_LENGTH). */
export function generateTemporaryPassword(length = Math.max(10, PASSWORD_MIN_LENGTH)): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => PASSWORD_ALPHABET[value % PASSWORD_ALPHABET.length]).join("");
}

/** Contas com vínculo ativo na empresa, por nome. */
export async function listUsersAccess(companyId: string): Promise<UserAccessRow[]> {
  const db = await getDb();
  const [users, memberships] = await Promise.all([
    db.select<User[]>("SELECT * FROM users WHERE deleted_at IS NULL ORDER BY name ASC"),
    db.select<Membership[]>("SELECT * FROM memberships WHERE company_id=? AND deleted_at IS NULL", [companyId]),
  ]);
  const byUser = new Map(memberships.map((membership) => [membership.user_id, membership]));
  return users
    .filter((user) => byUser.has(user.id))
    .map((user) => {
      const membership = byUser.get(user.id) as Membership;
      return {
        id: user.id,
        membership_id: membership.id,
        name: user.name,
        email: user.email,
        role: membership.role as Role,
        must_change_password: Number(user.must_change_password) === 1 ? 1 : 0,
        status: user.status,
      };
    });
}

async function findRow(companyId: string, userId: string): Promise<UserAccessRow> {
  const row = (await listUsersAccess(companyId)).find((item) => item.id === userId);
  if (!row) throw new Error("Conta não encontrada nesta empresa (pode ter sido removida).");
  return row;
}

function cleanName(value: unknown): string {
  const name = String(value ?? "").trim();
  if (!name) throw new Error("Informe o nome da pessoa.");
  return name;
}

function checkRole(value: unknown, actor: UsersActor): Role {
  if (!ROLES.has(String(value))) throw new Error("Papel inválido.");
  if (value === "ceo" && actor.role !== "ceo") throw new Error("Só o CEO concede o papel de CEO.");
  return value as Role;
}

/** O CEO cuida de qualquer conta; a Administração, das demais, nunca da do CEO. */
export const canManageAccount = (actor: UsersActor, row: Pick<UserAccessRow, "role">) => actor.role === "ceo" || row.role !== "ceo";

async function applyUpdate(companyId: string, actor: UsersActor, fields: UserAccessFields & { id: string }): Promise<void> {
  const row = await findRow(companyId, fields.id);
  if (!canManageAccount(actor, row)) throw new Error("Só o CEO altera a conta do CEO.");
  const self = row.id === actor.userId;
  const db = await getDb();

  if ("name" in fields || "email" in fields) {
    const name = "name" in fields ? cleanName(fields.name) : row.name;
    let email = row.email;
    if ("email" in fields) {
      email = normalizeEmail(String(fields.email ?? ""));
      if (!isValidEmail(email)) throw new Error("E-mail inválido.");
      if (email !== normalizeEmail(row.email)) {
        const unavailable = await emailUnavailable(email);
        if (unavailable) throw new Error(unavailable);
      }
    }
    if (name !== row.name || email !== row.email) {
      await db.execute("UPDATE users SET name=?, email=?, updated_at=datetime('now') WHERE id=? AND deleted_at IS NULL", [name, email, row.id]);
      await emit({ type: "user.updated", companyId, actorId: actor.userId, entityType: "user", entityId: row.id, title: `Conta atualizada: ${name}`, module: "settings", oldValue: { name: row.name, email: row.email }, newValue: { name, email } });
    }
  }

  if ("role" in fields && fields.role !== row.role) {
    if (self) throw new Error("Você não altera o seu próprio papel.");
    const role = checkRole(fields.role, actor);
    await db.execute("UPDATE memberships SET role=?, scope=?, updated_at=datetime('now') WHERE id=? AND company_id=? AND deleted_at IS NULL", [role, scopeForRole(role), row.membership_id, companyId]);
    await emit({ type: "user.role_changed", companyId, actorId: actor.userId, entityType: "user", entityId: row.id, title: `Papel alterado para ${ROLE_LABELS[role]}`, module: "settings", oldValue: { role: row.role }, newValue: { role } });
  }

  if ("must_change_password" in fields && isOn(fields.must_change_password) !== (row.must_change_password === 1)) {
    if (self) throw new Error("Você não exige a troca da sua própria senha: use Alterar senha.");
    const required = isOn(fields.must_change_password);
    await setPasswordChangeRequired(row.id, required);
    await emit({
      type: required ? "user.password_change_required" : "user.password_change_waived",
      companyId,
      actorId: actor.userId,
      entityType: "user",
      entityId: row.id,
      title: required ? `Troca de senha exigida: ${row.name}` : `Troca de senha dispensada: ${row.name}`,
      module: "settings",
    });
  }
}

/** Grava o que foi editado e adicionado na tabela de contas. Devolve as contas criadas com a senha temporária. */
export async function saveUserAccessChanges(companyId: string, actor: UsersActor, changes: UserAccessChanges): Promise<{ created: CreatedLogin[] }> {
  if (changes.created.length && !can(actor.role, "create", "users")) throw new Error("Seu perfil não tem permissão para criar contas.");
  if (changes.updated.length && !can(actor.role, "edit", "users")) throw new Error("Seu perfil não tem permissão para alterar contas.");
  // Confere tudo o que dá para conferir antes de gravar a primeira linha: uma conta criada antes de outra linha falhar
  // ficaria com uma senha temporária que ninguém viu (a tela só recebe as senhas quando o lote inteiro foi gravado).
  const emails = new Set<string>();
  for (const fields of changes.updated) if ("email" in fields) emails.add(normalizeEmail(String(fields.email ?? "")));
  for (const fields of changes.created) {
    cleanName(fields.name);
    checkRole(fields.role ?? "comercial", actor);
    const email = normalizeEmail(String(fields.email ?? ""));
    if (!isValidEmail(email)) throw new Error(email ? `E-mail inválido: ${email}.` : "Informe o e-mail da pessoa.");
    if (emails.has(email)) throw new Error(`O e-mail ${email} está em mais de uma linha.`);
    emails.add(email);
    const unavailable = await emailUnavailable(email);
    if (unavailable) throw new Error(`${email}: ${unavailable}`);
  }

  for (const fields of changes.updated) await applyUpdate(companyId, actor, fields);

  const created: CreatedLogin[] = [];
  for (const fields of changes.created) {
    const role = checkRole(fields.role ?? "comercial", actor);
    const mustChange = fields.must_change_password === undefined ? true : isOn(fields.must_change_password);
    const password = generateTemporaryPassword();
    const account = await createUserAccount({ companyId, name: cleanName(fields.name), email: String(fields.email ?? ""), password, role, mustChangePassword: mustChange });
    await emit({ type: "user.created", companyId, actorId: actor.userId, entityType: "user", entityId: account.userId, title: `Conta criada: ${account.name} (${ROLE_LABELS[role]})`, module: "settings" });
    created.push({ userId: account.userId, name: account.name, email: account.email, password, mustChange });
  }
  return { created };
}

/** Senha nova definida por CEO/Administração. Quem redefine a própria senha já escolheu a definitiva. */
export async function resetAccountPassword(companyId: string, actor: UsersActor, userId: string, password: string, mustChange: boolean): Promise<{ name: string; mustChange: boolean; self: boolean }> {
  if (!can(actor.role, "edit", "users")) throw new Error("Seu perfil não tem permissão para redefinir senhas.");
  const row = await findRow(companyId, userId);
  if (!canManageAccount(actor, row)) throw new Error("Só o CEO redefine a senha do CEO.");
  const self = row.id === actor.userId;
  const required = mustChange && !self;
  await resetUserPassword(row.id, password, { mustChange: required });
  await emit({ type: "user.password_reset", companyId, actorId: actor.userId, entityType: "user", entityId: row.id, title: `Senha redefinida: ${row.name}`, module: "settings" });
  return { name: row.name, mustChange: required, self };
}
