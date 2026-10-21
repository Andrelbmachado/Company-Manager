import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "@/lib/auth/login";
import { useSession } from "@/hooks/useSession";
import { Building2, Loader2 } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { isTauri } from "@/lib/runtime";

const DEMO_EMAIL = "admin@companymanager.local";
const DEMO_PASSWORD = "CompanyDemo2026!";

export default function LoginPage() {
  const { setSession } = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingSetup, setCheckingSetup] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await doLogin(email, password);
  }

  async function doLogin(email: string, password: string) {
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
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary shadow-lg">
            <Building2 size={24} className="text-primary-foreground" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold">Company Manager</h1>
            <p className="text-sm text-muted-foreground">Entre com sua conta</p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          data-testid="login-form"
          className="rounded-xl border bg-card p-6 shadow-sm space-y-4"
        >
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="email">
              E-mail
            </label>
            <input
              id="email"
              name="email"
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
              name="password"
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
            data-testid="login-submit"
            className="flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            Entrar
          </button>
        </form>

        {!isTauri() && (
          <div className="mt-4 rounded-xl border border-dashed bg-card/60 p-4 text-xs text-muted-foreground" data-testid="demo-hint">
            <p className="font-medium text-foreground">Preview no navegador</p>
            <p className="mt-1">
              Os dados ficam no armazenamento local do navegador. Conta demo: <code>{DEMO_EMAIL}</code> /{" "}
              <code>{DEMO_PASSWORD}</code>
            </p>
            <button
              type="button"
              data-testid="login-demo"
              disabled={loading}
              onClick={() => doLogin(DEMO_EMAIL, DEMO_PASSWORD)}
              className="mt-2 font-medium text-primary hover:underline disabled:opacity-50"
            >
              Entrar com a conta demo
            </button>
          </div>
        )}

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
      </div>
    </div>
  );
}
