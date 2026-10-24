import { useEffect, useState } from "react";
import { BrowserRouter } from "react-router-dom";
import { SessionContext } from "@/hooks/useSession";
import { AppRoutes } from "./routes";
import { clearSession, getSession } from "@/lib/auth/session";
import { mustChangePassword, revalidateSession } from "@/lib/auth/login";
import { upgradeLegacyPasswords } from "@/lib/auth/password";
import { isTauriRuntime } from "@/lib/db/client";
import ChangePasswordPage from "@/modules/settings/pages/ChangePasswordPage";
import type { Session } from "@/types";

let legacyUpgradeStarted = false;

export default function App() {
  const [session, setSession] = useState<Session | null>(() => getSession());

  // Senhas antigas guardadas em texto ("plain:") viram hash assim que o app desktop abre, sem esperar o login de cada pessoa.
  useEffect(() => {
    if (legacyUpgradeStarted || !isTauriRuntime()) return;
    legacyUpgradeStarted = true;
    upgradeLegacyPasswords().catch((error) => console.warn("[auth] não foi possível converter as senhas antigas", error));
  }, []);

  // Papel alterado, conta removida ou troca de senha exigida por outra pessoa vale já na próxima vez que a janela ganha foco.
  const membershipId = session?.membership.id;
  const role = session?.membership.role;
  const passwordChangeRequired = session ? mustChangePassword(session) : false;
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const check = () => {
      revalidateSession(session).then((next) => {
        if (cancelled || next === session) return;
        if (next) setSession(next);
        else { clearSession(); setSession(null); }
      }).catch(() => undefined);
    };
    check();
    window.addEventListener("focus", check);
    return () => { cancelled = true; window.removeEventListener("focus", check); };
    // session muda de identidade a cada atualização; o que importa para refazer a checagem é a conta, o papel e a troca de senha.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membershipId, role, passwordChangeRequired]);

  return (
    <SessionContext.Provider value={{ session, setSession }}>
      <BrowserRouter>
        {/* Troca de senha obrigatória: nenhuma tela do app abre antes dela. */}
        {passwordChangeRequired ? <ChangePasswordPage /> : <AppRoutes />}
      </BrowserRouter>
    </SessionContext.Provider>
  );
}
