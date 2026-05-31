import { useState } from "react";
import { useRequiredSession, useSession } from "@/hooks/useSession";
import { logout } from "@/lib/auth/login";
import { PageHeader } from "@/components/shared/PageHeader";
import { ASSISTANT_PROVIDERS, getAssistantApiConfig, saveAssistantApiConfig } from "@/lib/assistant/config";
import { LogOut, Building2, KeyRound, Save } from "lucide-react";

export default function SettingsPage() {
  const session = useRequiredSession();
  const { setSession } = useSession();
  const [apiConfig, setApiConfig] = useState(() => getAssistantApiConfig(session.user.id));
  const [saved, setSaved] = useState(false);
  const selectedProvider = ASSISTANT_PROVIDERS.find((provider) => provider.id === apiConfig.provider) ?? ASSISTANT_PROVIDERS[0];

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
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <KeyRound size={18} className="text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Assistente IA</h3>
            <p className="text-xs text-muted-foreground">Conexao pessoal usada somente pela sua conta.</p>
          </div>
        </div>
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
            Salvar conexao
          </button>
          {saved && <span className="text-xs text-emerald-600">Configuracao salva para esta conta.</span>}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          No prototipo web a configuracao fica armazenada localmente. Em producao, a chave deve ser protegida por um servico seguro.
        </p>
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
