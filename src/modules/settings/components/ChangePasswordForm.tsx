import { useId, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { changePassword, PASSWORD_MIN_LENGTH, passwordProblem } from "@/lib/auth/password";
import { emit } from "@/lib/events/bus";
import type { Session } from "@/types";

interface Props {
  session: Session;
  /** Configurações pedem a senha atual; a troca obrigatória logo após o login, não. */
  requireCurrent: boolean;
  submitLabel?: string;
  onDone: () => void;
}

const field = "flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring";

/** Formulário de troca da própria senha (Configurações e troca obrigatória no primeiro acesso). */
export function ChangePasswordForm({ session, requireCurrent, submitLabel = "Salvar nova senha", onDone }: Props) {
  const id = useId();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const problem = requireCurrent && !current ? "Informe a senha atual." : passwordProblem(next) ?? (next !== confirm ? "A confirmação não é igual à nova senha." : null);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      await changePassword(session.user.id, next, requireCurrent ? { currentPassword: current } : {});
      await emit({ type: "user.password_changed", companyId: session.company.id, actorId: session.user.id, entityType: "user", entityId: session.user.id, title: `Senha trocada: ${session.user.name}`, module: "settings" });
      setCurrent("");
      setNext("");
      setConfirm("");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível trocar a senha. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  const type = show ? "text" : "password";
  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {/* Campo oculto com o e-mail: gerenciadores de senha associam a senha nova à conta certa. */}
      <input type="email" name="username" autoComplete="username" value={session.user.email} readOnly hidden />
      {requireCurrent && (
        <div className="space-y-1.5">
          <label htmlFor={`${id}-current`} className="text-sm font-medium">Senha atual</label>
          <input id={`${id}-current`} type={type} autoComplete="current-password" value={current} onChange={(event) => { setError(""); setCurrent(event.target.value); }} className={field} />
        </div>
      )}
      <div className="space-y-1.5">
        <label htmlFor={`${id}-next`} className="text-sm font-medium">Nova senha</label>
        <input id={`${id}-next`} type={type} autoComplete="new-password" value={next} onChange={(event) => { setError(""); setNext(event.target.value); }} aria-describedby={`${id}-hint`} autoFocus={!requireCurrent} className={field} />
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">Pelo menos {PASSWORD_MIN_LENGTH} caracteres. Evite repetir a senha de outros sites.</p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${id}-confirm`} className="text-sm font-medium">Confirmar nova senha</label>
        <input id={`${id}-confirm`} type={type} autoComplete="new-password" value={confirm} onChange={(event) => { setError(""); setConfirm(event.target.value); }} className={field} />
      </div>
      <button type="button" onClick={() => setShow((value) => !value)} aria-pressed={show} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
        {show ? "Ocultar senhas" : "Mostrar senhas"}
      </button>
      {error && <p role="alert" className="rounded-md border border-status-danger bg-background px-3 py-2 text-sm font-medium text-status-danger dark:text-red-400">{error}</p>}
      <button type="submit" disabled={busy || !next || !confirm || (requireCurrent && !current)} className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
        {busy && <Loader2 size={15} className="animate-spin" />}
        {submitLabel}
      </button>
    </form>
  );
}
