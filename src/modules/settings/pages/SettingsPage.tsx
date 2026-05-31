import { useRequiredSession, useSession } from "@/hooks/useSession";
import { logout } from "@/lib/auth/login";
import { PageHeader } from "@/components/shared/PageHeader";
import { LogOut, Building2 } from "lucide-react";

export default function SettingsPage() {
  const session = useRequiredSession();
  const { setSession } = useSession();

  function handleLogout() {
    logout();
    setSession(null);
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader title="Configurações" description="Perfil, empresa e sistema" />

      {/* Company card */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Building2 size={18} className="text-primary" />
          </div>
          <div>
            <p className="font-semibold">{session.company.name}</p>
            <p className="text-xs text-muted-foreground">{session.company.document ?? "CNPJ não informado"}</p>
          </div>
        </div>
      </div>

      {/* User card */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold">
            {session.user.name.split(" ").slice(0, 2).map((n) => n[0]).join("").toUpperCase()}
          </div>
          <div>
            <p className="font-semibold">{session.user.name}</p>
            <p className="text-xs text-muted-foreground">{session.user.email}</p>
            <p className="text-xs text-muted-foreground capitalize">Papel: {session.membership.role}</p>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="rounded-xl border bg-card p-5 space-y-3">
        <h3 className="text-sm font-semibold">Conta</h3>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 rounded-md border border-destructive/30 px-4 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
        >
          <LogOut size={14} />
          Sair da conta
        </button>
      </div>

      <div className="text-xs text-muted-foreground">
        Company Manager v0.1.0 · Local-first · Código aberto
      </div>
    </div>
  );
}
