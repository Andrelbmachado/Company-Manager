import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "@/lib/auth/login";
import { useSession } from "@/hooks/useSession";
import { Building2, Loader2 } from "lucide-react";
import { getDb, isTauriRuntime } from "@/lib/db/client";
import { DEMO_ACCOUNTS } from "@/lib/db/demo";

export default function LoginPage() {
  const { setSession } = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingSetup, setCheckingSetup] = useState(false);
  const showDemoAccounts = !isTauriRuntime();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const session = await login(email, password);
      setSession(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao fazer login");
    } finally {
      setLoading(false);
    }
  }

  async function handleSetup() {
    setCheckingSetup(true);
    try {
      const db = await getDb();
      const companies = await db.select<{ id: string }[]>(
        "SELECT id FROM companies WHERE deleted_at IS NULL LIMIT 1"
      );
      if (companies.length > 0) {
        setError("Empresa já cadastrada. Use seu login.");
      } else {
        navigate("/setup");
      }
    } catch {
      navigate("/setup");
    } finally {
      setCheckingSetup(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className={`w-full ${showDemoAccounts ? "max-w-5xl" : "max-w-sm"}`}>
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary shadow-lg">
            <Building2 size={24} className="text-primary-foreground" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold">Company Manager</h1>
            <p className="text-sm text-muted-foreground">Entre com sua conta</p>
          </div>
        </div>

        <div className={showDemoAccounts ? "grid gap-4 lg:grid-cols-[22rem_1fr]" : ""}>
          <form
            onSubmit={handleSubmit}
            className="rounded-xl border bg-card p-6 shadow-sm space-y-4"
          >
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="email">
              E-mail
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              className="flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm shadow-sm transition-colors outline-none focus:ring-2 focus:ring-ring"
              placeholder="seu@email.com"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="password">
              Senha
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm shadow-sm transition-colors outline-none focus:ring-2 focus:ring-ring"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            Entrar
          </button>
          </form>

          {showDemoAccounts && (
            <div className="rounded-xl border bg-card p-5 shadow-sm">
              <div className="mb-4">
                <h2 className="font-semibold">Acessos de demonstracao</h2>
                <p className="text-xs text-muted-foreground">
                  Selecione um funcionario para preencher o login e comparar as permissoes de cada area.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {DEMO_ACCOUNTS.map((account) => (
                  <button
                    key={account.email}
                    type="button"
                    onClick={() => {
                      setEmail(account.email);
                      setPassword(account.password);
                    }}
                    className="rounded-lg border px-3 py-2 text-left transition-colors hover:bg-muted"
                  >
                    <span className="block text-sm font-medium">{account.area}</span>
                    <span className="block text-xs text-muted-foreground">{account.email}</span>
                  </button>
                ))}
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                Senha compartilhada no ambiente demo: <span className="font-mono font-medium text-foreground">demo123</span>
              </p>
            </div>
          )}
        </div>

        {!showDemoAccounts && (
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Primeiro acesso?{" "}
            <button
              onClick={handleSetup}
              disabled={checkingSetup}
              className="font-medium text-primary hover:underline disabled:opacity-50"
            >
              Configurar empresa
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
