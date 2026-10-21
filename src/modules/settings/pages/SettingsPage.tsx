import { useRef, useState } from "react";
import { Building2, DatabaseBackup, Download, LogOut, RotateCcw, Upload } from "lucide-react";
import { useRequiredSession, useSession } from "@/hooks/useSession";
import { useInvalidateEntities } from "@/hooks/useEntity";
import { logout } from "@/lib/auth/login";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/Button";
import { can } from "@/lib/permissions/rbac";
import { ENTITIES, type EntityKey } from "@/lib/data/entities";
import { exportBackup, importBackup, saveTextFile } from "@/lib/data/importExport";
import { browserReset } from "@/lib/data/browserStore";
import { isTauri } from "@/lib/runtime";
import { initials } from "@/lib/utils";
import type { Role } from "@/types";

export default function SettingsPage() {
  const session = useRequiredSession();
  const { setSession } = useSession();
  const invalidate = useInvalidateEntities();
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const role = session.membership.role as Role;

  const exportable = (Object.keys(ENTITIES) as EntityKey[]).filter(
    (k) => k !== "users" && can(role, "export", ENTITIES[k].resource)
  );
  const importable = (Object.keys(ENTITIES) as EntityKey[]).filter(
    (k) => ENTITIES[k].importable !== false && can(role, "create", ENTITIES[k].resource)
  );

  function handleLogout() {
    logout();
    setSession(null);
  }

  async function handleExport() {
    setBusy(true);
    setMessage(null);
    try {
      const saved = await saveTextFile(
        `backup-company-manager-${new Date().toISOString().slice(0, 10)}.json`,
        await exportBackup(session, exportable)
      );
      if (saved) setMessage({ tone: "ok", text: "Backup exportado." });
    } catch (e) {
      setMessage({ tone: "error", text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function handleImport(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      const reports = await importBackup(session, await file.text(), importable);
      invalidate();
      const inserted = reports.reduce((s, r) => s + r.inserted, 0);
      const errors = reports.reduce((s, r) => s + r.errors.length, 0);
      setMessage({
        tone: "ok",
        text: `${inserted} registros importados${errors ? `, ${errors} linhas com erro ignoradas` : ""}.`,
      });
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Configurações" description="Perfil, empresa e dados" />

      <section className="grid gap-4 md:grid-cols-2" aria-label="Empresa e perfil">
        <div className="flex items-center gap-3 rounded-xl border bg-card p-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Building2 size={18} className="text-primary" />
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold">{session.company.name}</p>
            <p className="text-xs text-muted-foreground">{session.company.document ?? "CNPJ não informado"}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border bg-card p-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary">
            {initials(session.user.name)}
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold">{session.user.name}</p>
            <p className="truncate text-xs text-muted-foreground">{session.user.email}</p>
            <p className="text-xs capitalize text-muted-foreground">Papel: {session.membership.role}</p>
          </div>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border bg-card p-5" aria-labelledby="data-heading">
        <div className="flex items-start gap-3">
          <DatabaseBackup size={18} className="mt-0.5 text-muted-foreground" />
          <div>
            <h2 id="data-heading" className="text-sm font-semibold">Dados e backup</h2>
            <p className="text-sm text-muted-foreground">
              Exporte todos os módulos em um único arquivo JSON ou restaure um backup. Cada módulo também tem
              seus próprios botões de importar e exportar.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleExport} disabled={busy || !exportable.length} data-testid="backup-export">
            <Download size={14} />
            Exportar tudo (JSON)
          </Button>
          <Button onClick={() => fileRef.current?.click()} disabled={busy || !importable.length} data-testid="backup-import">
            <Upload size={14} />
            Importar backup
          </Button>
          {!isTauri() && (
            <Button
              variant="ghost"
              data-testid="demo-reset"
              onClick={() => {
                browserReset();
                invalidate();
                setMessage({ tone: "ok", text: "Dados de demonstração restaurados." });
              }}
            >
              <RotateCcw size={14} />
              Restaurar dados de demonstração
            </Button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            data-testid="backup-file-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImport(file);
              e.target.value = "";
            }}
          />
        </div>
        {message && (
          <p
            role="status"
            className={
              message.tone === "ok"
                ? "rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                : "rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            }
          >
            {message.text}
          </p>
        )}
      </section>

      <section className="space-y-3 rounded-xl border bg-card p-5" aria-labelledby="account-heading">
        <h2 id="account-heading" className="text-sm font-semibold">Conta</h2>
        <Button variant="destructive" size="md" onClick={handleLogout} data-testid="settings-logout">
          <LogOut size={14} />
          Sair da conta
        </Button>
      </section>

      <p className="text-xs text-muted-foreground">Company Manager v0.1.0 · Local-first · Código aberto</p>
    </div>
  );
}
