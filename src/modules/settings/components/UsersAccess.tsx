import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Users, Wand2 } from "lucide-react";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useRequiredSession } from "@/hooks/useSession";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password";
import { ROLE_LABELS } from "@/lib/permissions/rbac";
import type { Role } from "@/types";
import {
  canManageAccount,
  generateTemporaryPassword,
  listUsersAccess,
  resetAccountPassword,
  saveUserAccessChanges,
  type CreatedLogin,
  type UserAccessRow,
} from "../usersAccess";

const ALL_ROLES = Object.keys(ROLE_LABELS) as Role[];
const STATUS_OPTIONS = [
  { value: "active", label: "Ativa" },
  { value: "suspended", label: "Suspensa" },
];
const INPUT = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring";
const BUTTON = "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-60";

/** Usuários e acessos da empresa: quem tem conta e qual papel (setor) define o que cada um vê. Edição na tabela. */
export function UsersAccess() {
  const session = useRequiredSession();
  const qc = useQueryClient();
  const companyId = session.company.id;
  const actor = { role: session.membership.role as Role, userId: session.user.id };
  // Só o CEO concede (ou retira) o papel de CEO; a Administração não pode se promover nem criar um CEO.
  const roles = actor.role === "ceo" ? ALL_ROLES : ALL_ROLES.filter((role) => role !== "ceo");
  const [logins, setLogins] = useState<CreatedLogin[]>([]);
  const [notice, setNotice] = useState("");
  const [resetting, setResetting] = useState<UserAccessRow | null>(null);

  const queryKey = ["users-access", companyId];
  const query = useQuery({ queryKey, queryFn: () => listUsersAccess(companyId) });
  const rows = query.data ?? [];
  const pendingCount = rows.filter((row) => row.must_change_password === 1).length;

  async function save(changes: EditableTableChanges<UserAccessRow>) {
    setNotice("");
    const { created } = await saveUserAccessChanges(companyId, actor, changes);
    setLogins(created);
  }

  const columns: EditableColumn<UserAccessRow>[] = [
    {
      key: "name",
      header: "Nome",
      kind: "text",
      required: true,
      render: (row) => (
        <span className="flex flex-wrap items-center gap-2 font-medium">
          {row.name}
          {row.id === session.user.id && <span className="text-xs font-normal text-muted-foreground">(você)</span>}
        </span>
      ),
    },
    { key: "email", header: "E-mail", kind: "email", required: true, placeholder: "será o login" },
    { key: "role", header: "Papel", kind: "select", options: roles.map((role) => ({ value: role, label: ROLE_LABELS[role] })), required: true, render: (row) => ROLE_LABELS[row.role] ?? row.role },
    { key: "must_change_password", header: "Trocar senha no próximo acesso", kind: "bool", render: (row) => (row.must_change_password === 1 ? <StatusBadge status="troca_senha" /> : "Não") },
    { key: "status", header: "Situação", kind: "select", options: STATUS_OPTIONS, readOnly: true, render: (row) => (row.status === "suspended" ? <StatusBadge status="suspended" /> : "Ativa") },
  ];

  return (
    <div className="space-y-4 rounded-xl border bg-card p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted"><Users size={18} className="text-muted-foreground" /></div>
        <div>
          <h3 className="text-sm font-bold">Usuários e acessos</h3>
          <p className="text-xs text-muted-foreground">
            O papel da conta define quais telas o colaborador vê. Conta nova recebe uma senha temporária.
            {pendingCount > 0 && ` ${pendingCount === 1 ? "1 conta ainda precisa" : `${pendingCount} contas ainda precisam`} trocar a senha.`}
          </p>
        </div>
      </div>

      <EditableTable<UserAccessRow>
        resource="users"
        label="Contas da empresa"
        title="Contas"
        rows={rows}
        columns={columns}
        loading={query.isLoading}
        newRow={() => ({ role: "comercial", must_change_password: 1 })}
        onSave={save}
        onRefresh={() => qc.invalidateQueries({ queryKey })}
        rowActions={(row) =>
          canManageAccount(actor, row) ? (
            <button type="button" onClick={() => { setNotice(""); setResetting(row); }} aria-label={`Redefinir senha de ${row.name}`} title="Redefinir senha" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
              <KeyRound size={14} />
            </button>
          ) : null
        }
        emptyMessage="Nenhuma conta nesta empresa."
      />

      {logins.length > 0 && (
        <div role="status" className="space-y-1 rounded-md border border-emerald-600/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300">
          {logins.map((login) => (
            <p key={login.userId}>
              Conta de {login.name} criada. Login: <strong>{login.email}</strong> · Senha temporária: <code className="rounded bg-background px-1.5 py-0.5 font-mono">{login.password}</code>
              {login.mustChange ? " (no primeiro acesso a pessoa escolhe outra)." : "."}
            </p>
          ))}
          <p className="text-xs">Passe a senha para a pessoa agora: ela não aparece de novo.</p>
        </div>
      )}
      {notice && <p role="status" className="text-sm font-medium text-status-success dark:text-green-400">{notice}</p>}

      {resetting && (
        <PasswordReset
          key={resetting.id}
          row={resetting}
          self={resetting.id === session.user.id}
          onCancel={() => setResetting(null)}
          onSubmit={async (password, mustChange) => {
            const result = await resetAccountPassword(companyId, actor, resetting.id, password, mustChange);
            setResetting(null);
            setNotice(result.self ? "Sua senha foi redefinida. Use a nova senha no próximo acesso." : result.mustChange ? `Senha de ${result.name} redefinida. Passe a senha temporária para a pessoa: no próximo acesso ela escolhe outra.` : `Senha de ${result.name} redefinida. Passe a nova senha para a pessoa.`);
            await qc.invalidateQueries({ queryKey });
          }}
        />
      )}
    </div>
  );
}

/** Redefinir senha no próprio lugar, abaixo da tabela (sem janela por cima). */
function PasswordReset({ row, self, onCancel, onSubmit }: { row: UserAccessRow; self: boolean; onCancel: () => void; onSubmit: (password: string, mustChange: boolean) => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [mustChange, setMustChange] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit(password, mustChange);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form data-password-reset onSubmit={submit} aria-label={`Redefinir a senha de ${row.name}`} className="space-y-3 rounded-lg border bg-muted/20 p-4">
      <h4 className="text-sm font-semibold">Redefinir a senha de {row.name}</h4>
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[14rem] flex-1 space-y-1 text-xs font-medium">
          Nova senha (mínimo {PASSWORD_MIN_LENGTH} caracteres)
          <input type={visible ? "text" : "password"} aria-label="Nova senha" value={password} onChange={(event) => { setError(""); setPassword(event.target.value); }} required minLength={PASSWORD_MIN_LENGTH} autoComplete="new-password" className={INPUT} />
        </label>
        <button type="button" onClick={() => { setPassword(generateTemporaryPassword()); setVisible(true); }} className={BUTTON}>
          <Wand2 size={14} aria-hidden="true" /> Gerar senha temporária
        </button>
      </div>
      {!self && (
        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" checked={mustChange} onChange={(event) => setMustChange(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-input accent-primary" />
          <span>
            Pedir para a pessoa trocar esta senha no próximo acesso
            <span className="block text-xs text-muted-foreground">A pessoa entra com a senha que você definiu e escolhe uma só dela antes de usar o sistema.</span>
          </span>
        </label>
      )}
      {error && <p role="alert" className="text-sm font-medium text-status-danger dark:text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className={BUTTON}>Cancelar</button>
        <button type="submit" disabled={busy} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
          <KeyRound size={14} aria-hidden="true" /> Redefinir senha
        </button>
      </div>
    </form>
  );
}
