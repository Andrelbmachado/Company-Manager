import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, RotateCcw, ShieldAlert, UserPlus, Users } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { createUserAccount } from "@/lib/auth/accounts";
import { PASSWORD_MIN_LENGTH, resetUserPassword, setPasswordChangeRequired } from "@/lib/auth/password";
import { emit } from "@/lib/events/bus";
import { ROLE_LABELS } from "@/lib/permissions/rbac";
import { useRequiredSession } from "@/hooks/useSession";
import { CrudDialog } from "@/components/shared/CrudDialog";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { Membership, Role, User } from "@/types";

const ALL_ROLES = Object.keys(ROLE_LABELS) as Role[];
const EMPTY = { name: "", email: "", password: "", role: "comercial" };
type Row = { user: User; membership: Membership };

const pendingChange = (user: User) => Number(user.must_change_password) === 1;

function MustChangeCheckbox({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="mt-4 flex items-start gap-2.5 text-sm">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-input accent-primary" />
      <span>
        {label}
        <span className="block text-xs text-muted-foreground">A pessoa entra com a senha que você definiu e escolhe uma só dela antes de usar o sistema.</span>
      </span>
    </label>
  );
}

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
  const [createMustChange, setCreateMustChange] = useState(true);
  const [error, setError] = useState("");
  const [resetting, setResetting] = useState<Row | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetMustChange, setResetMustChange] = useState(true);
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
  const fail = (err: unknown) => setError(err instanceof Error ? err.message : String(err));

  const create = useMutation({
    mutationFn: async () => {
      if (form.role === "ceo" && !isCeo) throw new Error("Só o CEO pode criar uma conta de CEO.");
      const role = form.role as Role;
      const account = await createUserAccount({ companyId, name: form.name, email: form.email, password: form.password, role, mustChangePassword: createMustChange });
      await emit({ type: "user.created", companyId, actorId: session.user.id, entityType: "user", entityId: account.userId, title: `Conta criada: ${account.name} (${ROLE_LABELS[role]})`, module: "settings" });
      return account;
    },
    onSuccess: (account) => {
      void refresh();
      setOpen(false);
      setForm(EMPTY);
      setError("");
      setNotice(createMustChange ? `Conta de ${account.name} criada. Passe o e-mail ${account.email} e a senha inicial: no primeiro acesso a pessoa escolhe uma senha nova.` : `Conta de ${account.name} criada (${account.email}).`);
    },
    onError: fail,
  });

  const changeRole = useMutation({
    mutationFn: async ({ membership, role }: { membership: Membership; role: Role }) => {
      if (!isCeo && (role === "ceo" || membership.role === "ceo")) throw new Error("Só o CEO altera o papel de CEO.");
      await (await getDb()).execute("UPDATE memberships SET role=?, updated_at=datetime('now') WHERE id=?", [role, membership.id]);
      await emit({ type: "user.role_changed", companyId, actorId: session.user.id, entityType: "user", entityId: membership.user_id, title: `Papel alterado para ${ROLE_LABELS[role]}`, module: "settings", oldValue: { role: membership.role }, newValue: { role } });
    },
    onSuccess: () => { void refresh(); setError(""); },
    onError: fail,
  });

  // O CEO cuida da senha de qualquer pessoa; a Administração, das dos demais, nunca da do CEO.
  const canManagePassword = (row: Row) => isCeo || row.membership.role !== "ceo";
  const reset = useMutation({
    mutationFn: async (row: Row) => {
      if (!canManagePassword(row)) throw new Error("Só o CEO redefine a senha do CEO.");
      // Quem redefine a própria senha já escolheu a definitiva.
      const mustChange = resetMustChange && row.user.id !== session.user.id;
      await resetUserPassword(row.user.id, newPassword, { mustChange });
      await emit({ type: "user.password_reset", companyId, actorId: session.user.id, entityType: "user", entityId: row.user.id, title: `Senha redefinida: ${row.user.name}`, module: "settings" });
      return { name: row.user.name, mustChange, self: row.user.id === session.user.id };
    },
    onSuccess: ({ name, mustChange, self }) => {
      void refresh();
      setResetting(null);
      setNewPassword("");
      setError("");
      setNotice(self ? "Sua senha foi redefinida. Use a nova senha no próximo acesso." : mustChange ? `Senha de ${name} redefinida. Passe a senha temporária para a pessoa: no próximo acesso ela escolhe outra.` : `Senha de ${name} redefinida. Passe a nova senha para a pessoa.`);
    },
    onError: fail,
  });

  const requireChange = useMutation({
    mutationFn: async ({ row, required }: { row: Row; required: boolean }) => {
      if (!canManagePassword(row)) throw new Error("Só o CEO exige a troca de senha do CEO.");
      await setPasswordChangeRequired(row.user.id, required);
      await emit({
        type: required ? "user.password_change_required" : "user.password_change_waived",
        companyId,
        actorId: session.user.id,
        entityType: "user",
        entityId: row.user.id,
        title: required ? `Troca de senha exigida: ${row.user.name}` : `Troca de senha dispensada: ${row.user.name}`,
        module: "settings",
      });
      return { name: row.user.name, required };
    },
    onSuccess: ({ name, required }) => {
      void refresh();
      setError("");
      setNotice(required ? `${name} vai escolher uma senha nova no próximo acesso (ou assim que voltar à janela, se estiver com o sistema aberto).` : `${name} não precisa mais trocar a senha.`);
    },
    onError: fail,
  });

  const rows = data ?? [];
  const pendingCount = rows.filter((row) => pendingChange(row.user)).length;

  return (
    <div className="space-y-4 rounded-xl border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted"><Users size={18} className="text-muted-foreground" /></div>
          <div>
            <h3 className="text-sm font-bold">Usuários e acessos</h3>
            <p className="text-xs text-muted-foreground">
              O papel da conta define quais telas o colaborador vê.
              {pendingCount > 0 && ` ${pendingCount === 1 ? "1 conta ainda precisa" : `${pendingCount} contas ainda precisam`} trocar a senha.`}
            </p>
          </div>
        </div>
        <button onClick={() => { setForm(EMPTY); setCreateMustChange(true); setError(""); setNotice(""); setOpen(true); }} className="flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"><UserPlus size={14} /> Nova conta</button>
      </div>

      <ul className="divide-y rounded-lg border">
        {rows.map((row) => {
          const { user, membership } = row;
          const self = user.id === session.user.id;
          const pending = pendingChange(user);
          return (
            <li key={user.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 truncate text-sm font-medium">
                  {user.name}
                  {pending && <StatusBadge status="troca_senha" />}
                  {user.status === "suspended" && <StatusBadge status="suspended" />}
                </p>
                <p className="truncate text-xs text-muted-foreground">{user.email}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {canManagePassword(row) && (
                  <button type="button" onClick={() => { setNewPassword(""); setResetMustChange(true); setError(""); setNotice(""); setResetting(row); }} className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-medium hover:bg-muted"><KeyRound size={14} /> Redefinir senha</button>
                )}
                {canManagePassword(row) && !self && (
                  pending ? (
                    <button type="button" disabled={requireChange.isPending} onClick={() => { setNotice(""); requireChange.mutate({ row, required: false }); }} title="A pessoa continua com a senha atual" className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-60"><RotateCcw size={14} /> Dispensar troca</button>
                  ) : (
                    <button type="button" disabled={requireChange.isPending} onClick={() => { setNotice(""); requireChange.mutate({ row, required: true }); }} title="No próximo acesso a pessoa escolhe uma senha nova" className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-60"><ShieldAlert size={14} /> Forçar troca de senha</button>
                  )
                )}
                <select
                  value={membership.role}
                  disabled={self || (!isCeo && membership.role === "ceo")}
                  onChange={(event) => changeRole.mutate({ membership, role: event.target.value as Role })}
                  aria-label={`Papel de ${user.name}`}
                  title={self ? "Você não altera o seu próprio papel" : !isCeo && membership.role === "ceo" ? "Só o CEO altera o papel de CEO" : undefined}
                  className="h-9 rounded-md border border-input bg-background px-2.5 text-sm disabled:opacity-60"
                >
                  {(isCeo || membership.role !== "ceo" ? ROLES : ALL_ROLES).map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
                </select>
              </div>
            </li>
          );
        })}
      </ul>

      {notice && <p role="status" className="text-sm font-medium text-status-success dark:text-green-400">{notice}</p>}
      {error && !open && !resetting && <p role="alert" className="text-sm font-medium text-status-danger dark:text-red-400">{error}</p>}

      {open && (
        <CrudDialog
          title="Nova conta"
          fields={[
            { key: "name", label: "Nome", required: true },
            { key: "email", label: "E-mail (será o login)", type: "email", required: true },
            { key: "password", label: `Senha inicial (mínimo ${PASSWORD_MIN_LENGTH} caracteres)`, type: "password", required: true },
            { key: "role", label: "Papel (setor)", type: "select", options: ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] })) },
          ]}
          values={form}
          onChange={(key, value) => { setError(""); setNotice(""); setForm((current) => ({ ...current, [key]: value })); }}
          onClose={() => setOpen(false)}
          onSubmit={() => create.mutate()}
          busy={create.isPending}
          submitLabel="Criar conta"
        >
          <MustChangeCheckbox checked={createMustChange} onChange={setCreateMustChange} label="Pedir para trocar a senha no primeiro acesso" />
          {error && <p role="alert" className="mt-3 text-sm font-medium text-status-danger dark:text-red-400">{error}</p>}
        </CrudDialog>
      )}

      {resetting && (
        <CrudDialog
          title={`Redefinir a senha de ${resetting.user.name}`}
          fields={[{ key: "password", label: `Nova senha (mínimo ${PASSWORD_MIN_LENGTH} caracteres)`, type: "password", required: true }]}
          values={{ password: newPassword }}
          onChange={(_key, value) => { setError(""); setNewPassword(value); }}
          onClose={() => setResetting(null)}
          onSubmit={() => reset.mutate(resetting)}
          busy={reset.isPending}
          submitLabel="Redefinir senha"
        >
          {resetting.user.id !== session.user.id && (
            <MustChangeCheckbox checked={resetMustChange} onChange={setResetMustChange} label="Pedir para a pessoa trocar esta senha no próximo acesso" />
          )}
          {error && <p role="alert" className="mt-3 text-sm font-medium text-status-danger dark:text-red-400">{error}</p>}
        </CrudDialog>
      )}
    </div>
  );
}
