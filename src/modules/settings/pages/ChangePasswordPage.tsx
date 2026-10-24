import { Building2, LogOut, ShieldCheck } from "lucide-react";
import { useRequiredSession, useSession } from "@/hooks/useSession";
import { logout, sessionAfterPasswordChange } from "@/lib/auth/login";
import { ChangePasswordForm } from "../components/ChangePasswordForm";

/**
 * Troca obrigatória de senha: aparece no lugar do app (App.tsx) enquanto users.must_change_password = 1 — senha inicial
 * das contas por setor, conta criada com "pedir troca no primeiro acesso", redefinição ou "forçar troca de senha".
 */
export default function ChangePasswordPage() {
  const session = useRequiredSession();
  const { setSession } = useSession();
  const firstName = session.user.name.split(" ")[0];

  function handleLogout() {
    logout();
    setSession(null);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4 sm:p-6">
      <div className="w-full max-w-[26rem] rounded-xl border bg-card p-6 shadow-lg sm:p-8">
        <div className="mb-6 flex items-center justify-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary"><Building2 size={18} className="text-primary-foreground" /></span>
          <span className="font-display text-lg font-bold tracking-tight">Company Manager</span>
        </div>

        <div className="mb-5 flex items-start gap-3 rounded-lg border bg-muted/40 p-3.5">
          <ShieldCheck size={20} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            Por segurança, a senha desta conta precisa ser trocada antes de continuar. A senha nova é só sua: ninguém da empresa fica sabendo dela.
          </p>
        </div>

        <h1 className="font-display text-[1.6rem] font-bold leading-tight tracking-tight">Escolha uma senha nova</h1>
        <p className="mt-1 text-sm text-muted-foreground">Olá, {firstName}. Você entrou como <strong className="text-foreground">{session.user.email}</strong>.</p>

        <div className="mt-6">
          <ChangePasswordForm session={session} requireCurrent={false} submitLabel="Salvar e continuar" onDone={() => setSession(sessionAfterPasswordChange(session))} />
        </div>

        <button type="button" onClick={handleLogout} className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-md border text-sm font-medium hover:bg-muted">
          <LogOut size={15} /> Sair e entrar com outra conta
        </button>
      </div>
    </main>
  );
}
