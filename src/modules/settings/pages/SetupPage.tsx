import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { getDb } from "@/lib/db/client";
import { hashPassword } from "@/lib/auth/login";
import { Building2, Loader2, CheckCircle2 } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { DEPARTMENTS } from "@/lib/departments/catalog";

type Step = "company" | "admin" | "done";

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

  async function handleCompany(e: React.FormEvent) {
    e.preventDefault();
    if (!companyName.trim()) return;
    setStep("admin");
  }

  async function handleAdmin(e: React.FormEvent) {
    e.preventDefault();
    if (adminPassword !== adminPassword2) {
      setError("As senhas não conferem.");
      return;
    }
    if (adminPassword.length < 6) {
      setError("Senha deve ter ao menos 6 caracteres.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const db = await getDb();
      const companyId = uuidv4();
      const userId = uuidv4();
      const membershipId = uuidv4();
      const hash = await hashPassword(adminPassword);

      await db.execute(
        "INSERT INTO companies (id, name, document) VALUES (?, ?, ?)",
        [companyId, companyName, companyDoc || null]
      );
      await db.execute(
        "INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)",
        [userId, adminName, adminEmail, hash]
      );
      await db.execute(
        "INSERT INTO memberships (id, company_id, user_id, role, scope) VALUES (?, ?, ?, 'admin', 'empresa')",
        [membershipId, companyId, userId]
      );
      for (const dept of DEPARTMENTS) {
        await db.execute(
          "INSERT OR IGNORE INTO departments (id, company_id, name, slug) VALUES (?, ?, ?, ?)",
          [uuidv4(), companyId, dept.name, dept.slug]
        );
      }

      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao configurar empresa");
    } finally {
      setLoading(false);
    }
  }

  if (step === "done") {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="text-center space-y-4">
          <CheckCircle2 size={48} className="mx-auto text-emerald-500" />
          <h2 className="text-xl font-bold">Empresa configurada!</h2>
          <p className="text-sm text-muted-foreground">
            Acesse com o e-mail e senha criados.
          </p>
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
              {step === "company" ? "Dados da empresa" : "Conta de administrador"}
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
              <label className="text-sm font-medium">Nome da empresa *</label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                required
                autoFocus
                className="flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm shadow-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="Minha Empresa Ltda"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">CNPJ (opcional)</label>
              <input
                type="text"
                value={companyDoc}
                onChange={(e) => setCompanyDoc(e.target.value)}
                className="flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm shadow-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="00.000.000/0001-00"
              />
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
          <form onSubmit={handleAdmin} className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Nome completo *</label>
              <input
                type="text"
                value={adminName}
                onChange={(e) => setAdminName(e.target.value)}
                required
                autoFocus
                className="flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm shadow-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="João Silva"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">E-mail *</label>
              <input
                type="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                required
                className="flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm shadow-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="admin@empresa.com"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Senha *</label>
              <input
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                required
                className="flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm shadow-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="••••••••"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Confirmar senha *</label>
              <input
                type="password"
                value={adminPassword2}
                onChange={(e) => setAdminPassword2(e.target.value)}
                required
                className="flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm shadow-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
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
                disabled={loading}
                className="flex h-9 flex-1 items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {loading && <Loader2 size={14} className="animate-spin" />}
                Criar conta
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
