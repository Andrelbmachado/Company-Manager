import { Building2, LogOut } from "lucide-react";
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

        <h1 className="font-display text-large-title font-bold tracking-tight">Escolha uma senha nova</h1>

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
