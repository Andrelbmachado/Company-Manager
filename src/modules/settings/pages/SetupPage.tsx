import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { getDb } from "@/lib/db/client";
import { createUserAccount, emailInUse, isValidEmail, normalizeEmail, type CreatedAccount } from "@/lib/auth/accounts";
import { PASSWORD_MIN_LENGTH, passwordProblem } from "@/lib/auth/password";
import { ALL_ROLES, isValidDomain, normalizeDomain, ROLE_ACCOUNT_DOMAIN, roleAccountEmail, seedRoleAccounts } from "@/lib/auth/seedRoleAccounts";
import { ROLE_LABELS } from "@/lib/permissions/rbac";
import { Building2, CheckCircle2, Copy, Loader2, TriangleAlert } from "lucide-react";
import { v4 as uuidv4 } from "uuid";

type Step = "company" | "admin" | "done";

const input = "flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm shadow-sm outline-none focus:ring-2 focus:ring-ring";
const SECTOR_ROLES = ALL_ROLES.filter((role) => role !== "ceo");

export default function SetupPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("company");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [companyName, setCompanyName] = useState("");
  const [companyDoc, setCompanyDoc] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminPassword2, setAdminPassword2] = useState("");

  const [withSectors, setWithSectors] = useState(false);
  const [sectorDomain, setSectorDomain] = useState(ROLE_ACCOUNT_DOMAIN);
  const [sectorPassword, setSectorPassword] = useState("");
  const [sectorAccounts, setSectorAccounts] = useState<CreatedAccount[]>([]);
  const [sectorError, setSectorError] = useState("");
  const [copied, setCopied] = useState(false);

  async function handleCompany(e: React.FormEvent) {
    e.preventDefault();
    if (!companyName.trim()) return;
    setStep("admin");
  }

  /** Tudo o que dá para conferir antes de gravar: assim um erro não deixa empresa sem CEO. */
  async function validate(): Promise<string | null> {
    if (!adminName.trim()) return "Informe o nome do CEO.";
    if (!isValidEmail(normalizeEmail(adminEmail))) return "E-mail inválido.";
    if (adminPassword !== adminPassword2) return "As senhas não conferem.";
    const problem = passwordProblem(adminPassword);
    if (problem) return problem;
    if (withSectors) {
      if (!isValidDomain(normalizeDomain(sectorDomain))) return "Domínio dos e-mails dos setores inválido (exemplo: empresa.com.br).";
      const sectorProblem = passwordProblem(sectorPassword);
      if (sectorProblem) return `Senha inicial dos setores: ${sectorProblem.charAt(0).toLowerCase()}${sectorProblem.slice(1)}`;
      if (sectorPassword === adminPassword) return "A senha inicial dos setores precisa ser diferente da senha do CEO.";
      if (SECTOR_ROLES.some((role) => roleAccountEmail(role, sectorDomain) === normalizeEmail(adminEmail))) return "O e-mail do CEO coincide com o de uma conta de setor. Use outro e-mail ou outro domínio.";
    }
    const db = await getDb();
    if ((await db.select<{ id: string }[]>("SELECT id FROM companies WHERE deleted_at IS NULL LIMIT 1")).length) return "Esta empresa já está cadastrada. Volte e entre com a sua conta.";
    if (await emailInUse(adminEmail)) return "Já existe uma conta com este e-mail.";
    return null;
  }

  async function handleAdmin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const problem = await validate();
      if (problem) {
        setError(problem);
        return;
      }
      const db = await getDb();
      const companyId = uuidv4();
      await db.execute("INSERT INTO companies (id, name, document) VALUES (?, ?, ?)", [companyId, companyName.trim(), companyDoc.trim() || null]);
      // A conta criada aqui é o CEO: só o CEO concede o papel de CEO depois.
      await createUserAccount({ companyId, name: adminName, email: adminEmail, password: adminPassword, role: "ceo" });

      if (withSectors) {
        try {
          setSectorAccounts(await seedRoleAccounts(companyId, sectorPassword, { domain: sectorDomain, roles: SECTOR_ROLES }));
        } catch (err) {
          setSectorError(err instanceof Error ? err.message : String(err));
        }
      }
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao configurar empresa");
    } finally {
      setLoading(false);
    }
  }

  async function copyList() {
    const text = sectorAccounts.map((account) => `${ROLE_LABELS[account.role]}: ${account.email}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (step === "done") {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-md space-y-5 text-center">
          <CheckCircle2 size={48} className="mx-auto text-emerald-500" />
          <div className="space-y-1">
            <h2 className="text-xl font-bold">Empresa configurada!</h2>
            <p className="text-sm text-muted-foreground">Entre com o e-mail e a senha do CEO.</p>
          </div>

          {sectorAccounts.length > 0 && (
            <div className="space-y-3 rounded-xl border bg-card p-4 text-left">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">Contas dos setores ({sectorAccounts.length})</h3>
                <button type="button" onClick={copyList} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted"><Copy size={13} /> {copied ? "Copiado" : "Copiar lista"}</button>
              </div>
              <ul className="divide-y rounded-lg border text-sm">
                {sectorAccounts.map((account) => (
                  <li key={account.userId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span className="font-medium">{ROLE_LABELS[account.role]}</span>
                    <span className="font-mono text-xs text-muted-foreground">{account.email}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">Todas entram com a senha inicial que você definiu e escolhem uma senha nova no primeiro acesso. Para criar mais contas ou trocar o papel de alguém: Configurações, Usuários e acessos.</p>
            </div>
          )}

          {sectorError && (
            <p role="alert" className="flex items-start gap-2 rounded-md border border-status-warning bg-background px-3 py-2 text-left text-sm">
              <TriangleAlert size={16} className="mt-0.5 shrink-0 text-status-warning" />
              <span>As contas dos setores não foram criadas ({sectorError}). Crie-as depois em Configurações, Usuários e acessos.</span>
            </p>
          )}

          <button
            onClick={() => navigate("/")}
            className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Ir para o login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary shadow-lg">
            <Building2 size={24} className="text-primary-foreground" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold">Configuração inicial</h1>
            <p className="text-sm text-muted-foreground">
              {step === "company" ? "Dados da empresa" : "Conta do CEO (acesso a tudo)"}
            </p>
          </div>
        </div>

        {/* Steps indicator */}
        <div className="mb-6 flex gap-2">
          {(["company", "admin"] as const).map((s, i) => {
            const active = step === s || (step === "admin" && i === 0);
            return (
              <div
                key={s}
                className={`h-1.5 flex-1 rounded-full ${active ? "bg-primary" : "bg-muted"}`}
              />
            );
          })}
        </div>

        {step === "company" && (
          <form onSubmit={handleCompany} className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="setup-company" className="text-sm font-medium">Nome da empresa *</label>
              <input id="setup-company" type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)} required autoFocus className={input} placeholder="Minha Empresa Ltda" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="setup-document" className="text-sm font-medium">CNPJ (opcional)</label>
              <input id="setup-document" type="text" value={companyDoc} onChange={(e) => setCompanyDoc(e.target.value)} className={input} placeholder="00.000.000/0001-00" />
            </div>
            <button
              type="submit"
              className="flex h-9 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Continuar
            </button>
          </form>
        )}

        {step === "admin" && (
          <form onSubmit={handleAdmin} className="rounded-xl border bg-card p-6 shadow-sm space-y-4" noValidate>
            <div className="space-y-1.5">
              <label htmlFor="setup-name" className="text-sm font-medium">Nome completo *</label>
              <input id="setup-name" type="text" value={adminName} onChange={(e) => setAdminName(e.target.value)} required autoFocus className={input} placeholder="João Silva" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="setup-email" className="text-sm font-medium">E-mail *</label>
              <input id="setup-email" type="email" autoComplete="username" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} required className={input} placeholder="ceo@empresa.com" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="setup-password" className="text-sm font-medium">Senha * <span className="font-normal text-muted-foreground">(mínimo {PASSWORD_MIN_LENGTH} caracteres)</span></label>
              <input id="setup-password" type="password" autoComplete="new-password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} required className={input} placeholder="••••••••" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="setup-password2" className="text-sm font-medium">Confirmar senha *</label>
              <input id="setup-password2" type="password" autoComplete="new-password" value={adminPassword2} onChange={(e) => setAdminPassword2(e.target.value)} required className={input} placeholder="••••••••" />
            </div>

            <fieldset className="space-y-3 rounded-lg border p-3">
              <label className="flex items-start gap-2.5 text-sm">
                <input type="checkbox" checked={withSectors} onChange={(e) => { setError(""); setWithSectors(e.target.checked); }} className="mt-0.5 h-4 w-4 rounded border-input accent-primary" />
                <span>
                  <span className="font-medium">Criar também uma conta para cada setor</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {SECTOR_ROLES.map((role) => ROLE_LABELS[role]).join(", ")}. E-mails como {roleAccountEmail("financeiro", sectorDomain || ROLE_ACCOUNT_DOMAIN)}, todos com a mesma senha inicial, que cada pessoa troca no primeiro acesso.
                  </span>
                </span>
              </label>
              {withSectors && (
                <>
                  <div className="space-y-1.5">
                    <label htmlFor="setup-domain" className="text-sm font-medium">Domínio dos e-mails</label>
                    <input id="setup-domain" type="text" value={sectorDomain} onChange={(e) => setSectorDomain(e.target.value)} className={input} placeholder={ROLE_ACCOUNT_DOMAIN} />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="setup-sector-password" className="text-sm font-medium">Senha inicial dos setores</label>
                    <input id="setup-sector-password" type="password" autoComplete="off" value={sectorPassword} onChange={(e) => setSectorPassword(e.target.value)} className={input} placeholder={`Mínimo ${PASSWORD_MIN_LENGTH} caracteres, diferente da do CEO`} />
                  </div>
                </>
              )}
            </fieldset>

            {error && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep("company")}
                className="flex h-9 flex-1 items-center justify-center rounded-md border text-sm font-medium hover:bg-muted transition-colors"
              >
                Voltar
              </button>
              <button
                type="submit"
                disabled={loading || !adminName || !adminEmail || !adminPassword || !adminPassword2 || (withSectors && !sectorPassword)}
                className="flex h-9 flex-1 items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {loading && <Loader2 size={14} className="animate-spin" />}
                {withSectors ? "Criar contas" : "Criar conta"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
