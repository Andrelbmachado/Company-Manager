import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Building2, Eye, EyeOff, Github, Loader2 } from "lucide-react";
import { login } from "@/lib/auth/login";
import { SOCIAL_PROVIDERS, startSocialLogin, type SocialProvider } from "@/lib/auth/social";
import { getDb, isTauriRuntime } from "@/lib/db/client";
import { useSession } from "@/hooks/useSession";

const field = "flex h-11 w-full rounded-lg border border-input bg-background px-3.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring";

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 23 23" aria-hidden="true">
      <path fill="#F25022" d="M1 1h10v10H1z" />
      <path fill="#7FBA00" d="M12 1h10v10H12z" />
      <path fill="#00A4EF" d="M1 12h10v10H1z" />
      <path fill="#FFB900" d="M12 12h10v10H12z" />
    </svg>
  );
}

const SOCIAL_ICONS: Record<SocialProvider, React.ReactNode> = {
  github: <Github size={18} aria-hidden="true" />,
  google: <GoogleIcon />,
  microsoft: <MicrosoftIcon />,
};

export default function LoginPage() {
  const { setSession } = useSession();
  const navigate = useNavigate();
  const [view, setView] = useState<"login" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingSetup, setCheckingSetup] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      setSession(await login(email.trim(), password));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível entrar. Tente de novo.");
    } finally {
      setLoading(false);
    }
  }

  function handleSocial(provider: SocialProvider) {
    setError("");
    try {
      startSocialLogin(provider);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login social indisponível.");
    }
  }

  async function handleSetup() {
    setCheckingSetup(true);
    try {
      const companies = await (await getDb()).select<{ id: string }[]>("SELECT id FROM companies WHERE deleted_at IS NULL LIMIT 1");
      if (companies.length > 0) setError("Esta empresa já está cadastrada. Entre com a sua conta.");
      else navigate("/setup");
    } catch {
      navigate("/setup");
    } finally {
      setCheckingSetup(false);
    }
  }

  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="hidden flex-col justify-between bg-sidebar p-14 lg:flex">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary"><Building2 size={20} className="text-primary-foreground" /></span>
          <span className="font-display text-xl font-bold tracking-tight text-sidebar-accent-foreground">Company Manager</span>
        </div>
        <div className="max-w-lg">
          <h2 className="font-display text-[3.25rem] font-bold leading-[1.05] tracking-tight text-sidebar-accent-foreground">Cada setor entra e vê o que é seu.</h2>
          <p className="mt-6 max-w-md text-base leading-relaxed text-sidebar-foreground">
            Comercial, projetos, estoque, financeiro, suporte e pessoas no mesmo sistema. O seu e-mail define o seu acesso: quem é de vendas não vê o RH da empresa, e todo colaborador tem o seu Meu RH.
          </p>
        </div>
        <p className="text-sm text-sidebar-foreground">Dúvida sobre o seu acesso? Fale com o administrador da empresa.</p>
      </aside>

      <main className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-[26rem]">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary"><Building2 size={18} className="text-primary-foreground" /></span>
            <span className="font-display text-lg font-bold tracking-tight">Company Manager</span>
          </div>

          {view === "login" ? (
            <>
              <h1 className="font-display text-[2rem] font-bold leading-tight tracking-tight">Entrar</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">Use o e-mail e a senha da sua conta.</p>

              <form onSubmit={handleSubmit} className="mt-8 space-y-5" noValidate>
                <div className="space-y-1.5">
                  <label htmlFor="email" className="text-sm font-medium">E-mail</label>
                  <input id="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus placeholder="voce@empresa.com" className={field} />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="password" className="text-sm font-medium">Senha</label>
                    <button type="button" onClick={() => { setError(""); setView("forgot"); }} className="text-sm font-medium text-primary-text hover:underline">Esqueci minha senha</button>
                  </div>
                  <div className="relative">
                    <input id="password" type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required placeholder="Sua senha" className={`${field} pr-11`} />
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                      aria-pressed={showPassword}
                      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                {error && <p role="alert" className="rounded-lg border border-status-danger bg-card px-3.5 py-2.5 text-sm font-medium text-status-danger dark:text-red-400">{error}</p>}

                <button type="submit" disabled={loading || !email || !password} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
                  {loading && <Loader2 size={16} className="animate-spin" />}
                  Entrar
                </button>
              </form>

              <div className="my-7 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />ou continue com<span className="h-px flex-1 bg-border" />
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                {SOCIAL_PROVIDERS.map((provider) => (
                  <button key={provider.id} type="button" onClick={() => handleSocial(provider.id)} aria-label={`Entrar com ${provider.label}`} className="flex h-11 items-center justify-center gap-2 rounded-lg border bg-card text-sm font-medium hover:bg-muted">
                    {SOCIAL_ICONS[provider.id]}
                    <span className="hidden sm:inline" aria-hidden="true">{provider.label}</span>
                  </button>
                ))}
              </div>

              {isTauriRuntime() && (
                <p className="mt-8 text-center text-sm text-muted-foreground">
                  Primeiro acesso?{" "}
                  <button onClick={handleSetup} disabled={checkingSetup} className="font-medium text-primary-text hover:underline disabled:opacity-50">Configurar empresa</button>
                </p>
              )}
            </>
          ) : (
            <>
              <button type="button" onClick={() => setView("login")} className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={14} /> Voltar para entrar</button>
              <h1 className="font-display text-[2rem] font-bold leading-tight tracking-tight">Esqueci minha senha</h1>
              <div className="mt-4 space-y-3 text-sm text-muted-foreground">
                <p>A redefinição por e-mail ainda não está ativa neste sistema. Por enquanto, quem redefine a senha é o CEO ou a Administração da empresa, em Configurações, Usuários e acessos.</p>
                <p>Peça a ele para redefinir a senha da conta <strong className="text-foreground">{email.trim() || "do seu e-mail"}</strong> e entre de novo com a senha nova.</p>
              </div>
              <button type="button" onClick={() => setView("login")} className="mt-8 flex h-11 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">Voltar para entrar</button>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
