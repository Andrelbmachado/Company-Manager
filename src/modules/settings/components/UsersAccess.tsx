import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { v4 as uuidv4 } from "uuid";
import { KeyRound, UserPlus, Users } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { hashPassword } from "@/lib/auth/login";
import { emit } from "@/lib/events/bus";
import { ROLE_LABELS } from "@/lib/permissions/rbac";
import { useRequiredSession } from "@/hooks/useSession";
import { CrudDialog } from "@/components/shared/CrudDialog";
import type { Membership, Role, User } from "@/types";

const ALL_ROLES = Object.keys(ROLE_LABELS) as Role[];
const EMPTY = { name: "", email: "", password: "", role: "comercial" };
type Row = { user: User; membership: Membership };

/** Usuários e acessos da empresa: quem tem conta e qual papel (setor) define o que cada um vê. */
export function UsersAccess() {
  const session = useRequiredSession();
  const qc = useQueryClient();
  const companyId = session.company.id;
  // Só o CEO concede (ou retira) o papel de CEO; a Administração não pode se promover nem criar um CEO.
  const isCeo = session.membership.role === "ceo";
  const ROLES = isCeo ? ALL_ROLES : ALL_ROLES.filter((role) => role !== "ceo");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>(EMPTY);
  const [error, setError] = useState("");
  const [resetting, setResetting] = useState<Row | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [notice, setNotice] = useState("");

  const { data } = useQuery({
    queryKey: ["users-access", companyId],
    queryFn: async () => {
      const db = await getDb();
      const [users, memberships] = await Promise.all([
        db.select<User[]>("SELECT * FROM users WHERE deleted_at IS NULL ORDER BY name ASC"),
        db.select<Membership[]>("SELECT * FROM memberships WHERE company_id=? AND deleted_at IS NULL", [companyId]),
      ]);
      const roleByUser = new Map(memberships.map((membership) => [membership.user_id, membership]));
      return users.filter((user) => roleByUser.has(user.id)).map((user) => ({ user, membership: roleByUser.get(user.id) as Membership }));
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["users-access"] });

  const create = useMutation({
    mutationFn: async () => {
      const db = await getDb();
      const email = form.email.trim().toLowerCase();
      if (form.role === "ceo" && !isCeo) throw new Error("Só o CEO pode criar uma conta de CEO.");
      if (form.password.length < 6) throw new Error("A senha precisa ter pelo menos 6 caracteres.");
      if ((await db.select<User[]>("SELECT * FROM users WHERE lower(email) = ? AND deleted_at IS NULL LIMIT 1", [email])).length) throw new Error("Já existe uma conta com este e-mail.");
      const id = uuidv4();
      await db.execute("INSERT INTO users (id, name, email, password_hash) VALUES (?,?,?,?)", [id, form.name.trim(), email, await hashPassword(form.password)]);
      await db.execute("INSERT OR IGNORE INTO memberships (id, company_id, user_id, role, scope) VALUES (?,?,?,?,?)", [uuidv4(), companyId, id, form.role, form.role === "ceo" || form.role === "admin" || form.role === "gerente" ? "empresa" : "setor"]);
      await emit({ type: "user.created", companyId, actorId: session.user.id, entityType: "user", entityId: id, title: `Conta criada: ${form.name.trim()} (${ROLE_LABELS[form.role as Role]})`, module: "settings" });
    },
    onSuccess: () => { void refresh(); setOpen(false); setForm(EMPTY); setError(""); },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });

  const changeRole = useMutation({
    mutationFn: async ({ membership, role }: { membership: Membership; role: Role }) => {
      if (!isCeo && (role === "ceo" || membership.role === "ceo")) throw new Error("Só o CEO altera o papel de CEO.");
      await (await getDb()).execute("UPDATE memberships SET role=?, updated_at=datetime('now') WHERE id=?", [role, membership.id]);
      await emit({ type: "user.role_changed", companyId, actorId: session.user.id, entityType: "user", entityId: membership.user_id, title: `Papel alterado para ${ROLE_LABELS[role]}`, module: "settings", oldValue: { role: membership.role }, newValue: { role } });
    },
    onSuccess: () => { void refresh(); setError(""); },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });

  // O CEO redefine a senha de qualquer pessoa; a Administração redefine as dos demais, nunca a do CEO.
  const canReset = (row: Row) => isCeo || row.membership.role !== "ceo";
  const reset = useMutation({
    mutationFn: async (row: Row) => {
      if (!canReset(row)) throw new Error("Só o CEO redefine a senha do CEO.");
      if (newPassword.length < 6) throw new Error("A senha precisa ter pelo menos 6 caracteres.");
      await (await getDb()).execute("UPDATE users SET password_hash=?, updated_at=datetime('now') WHERE id=?", [await hashPassword(newPassword), row.user.id]);
      await emit({ type: "user.password_reset", companyId, actorId: session.user.id, entityType: "user", entityId: row.user.id, title: `Senha redefinida: ${row.user.name}`, module: "settings" });
      return row.user.name;
    },
    onSuccess: (name) => { setResetting(null); setNewPassword(""); setError(""); setNotice(`Senha de ${name} redefinida. Passe a nova senha para a pessoa.`); },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });

  return (
    <div className="space-y-4 rounded-xl border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted"><Users size={18} className="text-muted-foreground" /></div>
          <div>
            <h3 className="text-sm font-bold">Usuários e acessos</h3>
            <p className="text-xs text-muted-foreground">O papel da conta define quais telas o colaborador vê.</p>
          </div>
        </div>
        <button onClick={() => { setForm(EMPTY); setError(""); setOpen(true); }} className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"><UserPlus size={14} /> Nova conta</button>
      </div>

      <ul className="divide-y rounded-lg border">
        {(data ?? []).map(({ user, membership }) => (
          <li key={user.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </div>
            <div className="flex items-center gap-2">
            {canReset({ user, membership }) && (
              <button type="button" onClick={() => { setNewPassword(""); setError(""); setNotice(""); setResetting({ user, membership }); }} className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-medium hover:bg-muted"><KeyRound size={14} /> Redefinir senha</button>
            )}
            <select
              value={membership.role}
              disabled={user.id === session.user.id || (!isCeo && membership.role === "ceo")}
              onChange={(event) => changeRole.mutate({ membership, role: event.target.value as Role })}
              aria-label={`Papel de ${user.name}`}
              title={user.id === session.user.id ? "Você não altera o seu próprio papel" : !isCeo && membership.role === "ceo" ? "Só o CEO altera o papel de CEO" : undefined}
              className="h-9 rounded-md border border-input bg-background px-2.5 text-sm disabled:opacity-60"
            >
              {(isCeo || membership.role !== "ceo" ? ROLES : ALL_ROLES).map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
            </select>
            </div>
          </li>
        ))}
      </ul>

      {notice && <p role="status" className="text-sm font-medium text-status-success dark:text-green-400">{notice}</p>}
      {error && !open && !resetting && <p role="alert" className="text-sm font-medium text-status-danger dark:text-red-400">{error}</p>}

      {open && (
        <CrudDialog
          title="Nova conta"
          fields={[
            { key: "name", label: "Nome", required: true },
            { key: "email", label: "E-mail (será o login)", type: "email", required: true },
            { key: "password", label: "Senha inicial", type: "password", required: true },
            { key: "role", label: "Papel (setor)", type: "select", options: ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] })) },
          ]}
          values={form}
          onChange={(key, value) => { setError(""); setNotice(""); setForm((current) => ({ ...current, [key]: value })); }}
          onClose={() => setOpen(false)}
          onSubmit={() => create.mutate()}
          busy={create.isPending}
          submitLabel="Criar conta"
        >
          {error && <p role="alert" className="mt-3 text-sm font-medium text-status-danger dark:text-red-400">{error}</p>}
        </CrudDialog>
      )}

      {resetting && (
        <CrudDialog
          title={`Redefinir a senha de ${resetting.user.name}`}
          fields={[{ key: "password", label: "Nova senha (mínimo 6 caracteres)", type: "password", required: true }]}
          values={{ password: newPassword }}
          onChange={(_key, value) => { setError(""); setNewPassword(value); }}
          onClose={() => setResetting(null)}
          onSubmit={() => reset.mutate(resetting)}
          busy={reset.isPending}
          submitLabel="Redefinir senha"
        >
          {error && <p role="alert" className="mt-3 text-sm font-medium text-status-danger dark:text-red-400">{error}</p>}
        </CrudDialog>
      )}
    </div>
  );
}
