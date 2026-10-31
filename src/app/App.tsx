import { useEffect, useState } from "react";
import { BrowserRouter } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { SessionContext } from "@/hooks/useSession";
import { AppRoutes } from "./routes";
import { ScrollScreen } from "./layout/ScrollScreen";
import { clearSession, getSession } from "@/lib/auth/session";
import { mustChangePassword, revalidateSession } from "@/lib/auth/login";
import { upgradeLegacyPasswords } from "@/lib/auth/password";
import { startDailyBackup } from "@/lib/backup/backup";
import { getDb, isTauriRuntime } from "@/lib/db/client";
import { startAppUpdater } from "@/lib/updater/autostart";
import { UpdateBanner } from "@/components/shared/updater/UpdatePanel";
import ChangePasswordPage from "@/modules/settings/pages/ChangePasswordPage";
import type { Session } from "@/types";

let legacyUpgradeStarted = false;
let dailyBackupStarted = false;
let demoModeInitStarted = false;
let updaterStarted = false;
/** Empresas cujos dados de exemplo já foram completados nesta execução do app. */
const demoRefreshed = new Set<string>();

export default function App() {
  const [session, setSession] = useState<Session | null>(() => getSession());
  const queryClient = useQueryClient();

  // Senhas antigas guardadas em texto ("plain:") viram hash assim que o app desktop abre, sem esperar o login de cada pessoa.
  useEffect(() => {
    if (legacyUpgradeStarted || !isTauriRuntime()) return;
    legacyUpgradeStarted = true;
    upgradeLegacyPasswords().catch((error) => console.warn("[auth] não foi possível converter as senhas antigas", error));
  }, []);

  // Backup automático diário do banco e dos anexos (só desktop; mantém os 14 mais recentes): src/lib/backup/backup.ts.
  useEffect(() => {
    if (dailyBackupStarted || !isTauriRuntime()) return;
    dailyBackupStarted = true;
    startDailyBackup();
  }, []);

  // Atualização automática (só desktop): verificação silenciosa na abertura e a cada 24 h; baixar e instalar só com o
  // clique em "Atualizar" (src/lib/updater).
  useEffect(() => {
    if (updaterStarted || !isTauriRuntime()) return;
    updaterStarted = true;
    startAppUpdater();
  }, []);

  // Primeira abertura depois da atualização do modo demonstração (só desktop): empresa sem a chave demo_mode fica com o
  // modo desligado e sem os dados fictícios que o login rápido antigo gravava; leads ficam (src/lib/demo/demoMode.ts).
  useEffect(() => {
    if (demoModeInitStarted || !isTauriRuntime()) return;
    demoModeInitStarted = true;
    // Import dinâmico: os seeds que o modo demonstração usa não entram no pacote principal.
    Promise.all([getDb(), import("@/lib/demo/demoMode")])
      .then(([db, { initDemoMode }]) => initDemoMode(db))
      .then((results) => {
        if (results.some((result) => result.removed > 0)) void queryClient.invalidateQueries();
      })
      .catch((error) => console.warn("[demo] não foi possível limpar os dados de exemplo antigos", error));
  }, [queryClient]);

  // Modo demonstração ligado: ao abrir, os seeds rodam de novo (idempotentes) e completam o que faltar, inclusive dados
  // de exemplo novos de uma atualização (src/lib/demo/demoMode.ts, refreshDemoData).
  const sessionCompanyId = session?.company.id;
  useEffect(() => {
    if (!sessionCompanyId || demoRefreshed.has(sessionCompanyId)) return;
    demoRefreshed.add(sessionCompanyId);
    Promise.all([getDb(), import("@/lib/demo/demoMode")])
      .then(([db, { refreshDemoData }]) => refreshDemoData(db, sessionCompanyId))
      .then((results) => {
        if (results.length > 0) void queryClient.invalidateQueries();
      })
      .catch((error) => console.warn("[demo] não foi possível completar os dados de exemplo", error));
  }, [sessionCompanyId, queryClient]);

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
        {passwordChangeRequired ? <ScrollScreen><ChangePasswordPage /></ScrollScreen> : <AppRoutes />}
        {isTauriRuntime() && <UpdateBanner />}
      </BrowserRouter>
    </SessionContext.Provider>
  );
}
