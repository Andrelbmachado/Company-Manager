import { useState } from "react";
import { useRequiredSession, useSession } from "@/hooks/useSession";
import { logout } from "@/lib/auth/login";
import { PageHeader } from "@/components/shared/PageHeader";
import { usePermission } from "@/hooks/usePermission";
import { UsersAccess } from "../components/UsersAccess";
import { ChangePasswordForm } from "../components/ChangePasswordForm";
import { DemoModeCard } from "../components/DemoModeCard";
import { EmailOutboxCard } from "../components/EmailOutboxCard";
import { AssistantModeSettings } from "../components/AssistantModeSettings";
import { ASSISTANT_PROVIDERS, getAssistantApiConfig, saveAssistantApiConfig } from "@/lib/assistant/config";
import { ROLE_LABELS } from "@/lib/permissions/rbac";
import { LogOut, Building2, KeyRound, LockKeyhole, Save, CloudDownload } from "lucide-react";
import { UpdatePanel, useUpdateState } from "@/components/shared/updater/UpdatePanel";
import { isTauriRuntime } from "@/lib/db/client";
import type { Role } from "@/types";

export default function SettingsPage() {
  const session = useRequiredSession();
  const { setSession } = useSession();
  const [apiConfig, setApiConfig] = useState(() => getAssistantApiConfig(session.user.id));
  const [saved, setSaved] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);
  const canManageUsers = usePermission("create", "users");
  const installedVersion = useUpdateState().currentVersion;
  const selectedProvider = ASSISTANT_PROVIDERS.find((provider) => provider.id === apiConfig.provider) ?? ASSISTANT_PROVIDERS[0];

  function handleLogout() {
    logout();
    setSession(null);
  }

  return (
    // Largura toda da área de conteúdo: seções em duas colunas na janela larga; título, contas e acessos e o rodapé
    // na linha inteira.
    <div className="grid w-full grid-cols-1 items-start gap-6 xl:grid-cols-2 [&>*:first-child]:xl:col-span-2 [&>*:last-child]:xl:col-span-2">
      <PageHeader title="Configurações" />

      {/* Company card */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Building2 size={18} className="text-primary-text" />
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
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary-text font-semibold">
            {session.user.name.split(" ").slice(0, 2).map((n) => n[0]).join("").toUpperCase()}
          </div>
          <div>
            <p className="font-semibold">{session.user.name}</p>
            <p className="text-xs text-muted-foreground">{session.user.email}</p>
            <p className="text-xs text-muted-foreground">Papel: {ROLE_LABELS[session.membership.role as Role] ?? session.membership.role}</p>
          </div>
        </div>
      </div>

      {/* Senha da própria conta */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <LockKeyhole size={18} className="text-primary-text" />
            </div>
            <h3 className="text-sm font-semibold">Senha</h3>
          </div>
          {!passwordOpen && (
            <button type="button" onClick={() => { setPasswordChanged(false); setPasswordOpen(true); }} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted">
              Alterar senha
            </button>
          )}
        </div>
        {passwordChanged && <p role="status" className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Senha alterada.</p>}
        {passwordOpen && (
          <div className="max-w-sm space-y-3">
            <ChangePasswordForm session={session} requireCurrent onDone={() => { setPasswordOpen(false); setPasswordChanged(true); }} />
            <button type="button" onClick={() => setPasswordOpen(false)} className="text-sm text-muted-foreground hover:text-foreground">Cancelar</button>
          </div>
        )}
      </div>

      {/* Atualizações (só no app desktop): src/lib/updater */}
      {isTauriRuntime() && (
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <CloudDownload size={18} className="text-primary-text" />
            </div>
            <h3 className="text-sm font-semibold">Atualizações</h3>
          </div>
          <UpdatePanel />
        </div>
      )}

      {/* E-mails das notificações importantes: só quem publica comunicados (o card some para os outros papéis) */}
      <EmailOutboxCard />

      {/* Modo demonstração: só CEO e Administração (o card some para os outros papéis) */}
      <DemoModeCard />

      {canManageUsers && <div className="xl:col-span-2"><UsersAccess /></div>}

      {/* Actions */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <KeyRound size={18} className="text-primary-text" />
          </div>
          <h3 className="text-sm font-semibold">Assistente IA</h3>
        </div>
        <AssistantModeSettings />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs font-medium">
            Provedor
            <select
              value={apiConfig.provider}
              onChange={(event) => {
                const provider = ASSISTANT_PROVIDERS.find((item) => item.id === event.target.value) ?? ASSISTANT_PROVIDERS[0];
                setApiConfig((config) => ({
                  ...config,
                  provider: provider.id,
                  endpoint: provider.endpoint,
                  model: provider.models[0],
                }));
              }}
              className="flex h-9 w-full rounded-md border bg-background px-3 text-sm font-normal outline-none focus:ring-2 focus:ring-ring"
            >
              {ASSISTANT_PROVIDERS.map((provider) => (
                <option key={provider.id} value={provider.id}>{provider.label}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium">
            Modelo
            <select
              value={apiConfig.model}
              onChange={(event) => setApiConfig((config) => ({ ...config, model: event.target.value }))}
              className="flex h-9 w-full rounded-md border bg-background px-3 text-sm font-normal outline-none focus:ring-2 focus:ring-ring"
            >
              {selectedProvider.models.map((model) => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium sm:col-span-2">
            Endpoint
            <input
              value={apiConfig.endpoint}
              onChange={(event) => setApiConfig((config) => ({ ...config, endpoint: event.target.value }))}
              className="flex h-9 w-full rounded-md border bg-background px-3 text-sm font-normal outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="space-y-1 text-xs font-medium sm:col-span-2">
            Chave de API
            <input
              type="password"
              value={apiConfig.apiKey}
              onChange={(event) => setApiConfig((config) => ({ ...config, apiKey: event.target.value }))}
              placeholder="sk-..."
              className="flex h-9 w-full rounded-md border bg-background px-3 text-sm font-normal outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              saveAssistantApiConfig(session.user.id, apiConfig);
              setSaved(true);
            }}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Save size={14} />
            Salvar conexão
          </button>
          {saved && <span className="text-xs text-emerald-700 dark:text-emerald-400">Configuração salva para esta conta.</span>}
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
        Company Manager{installedVersion ? ` v${installedVersion}` : ""}
      </div>
    </div>
  );
}
