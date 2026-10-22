import { useEffect, useState } from "react";
import { BrowserRouter } from "react-router-dom";
import { SessionContext } from "@/hooks/useSession";
import { AppRoutes } from "./routes";
import { clearSession, getSession } from "@/lib/auth/session";
import { revalidateSession } from "@/lib/auth/login";
import type { Session } from "@/types";

export default function App() {
  const [session, setSession] = useState<Session | null>(() => getSession());

  // Papel alterado ou conta removida por outra pessoa vale já na próxima vez que a janela ganha foco.
  const membershipId = session?.membership.id;
  const role = session?.membership.role;
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
    // session muda de identidade a cada atualização; o que importa para refazer a checagem é a conta e o papel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membershipId, role]);

  return (
    <SessionContext.Provider value={{ session, setSession }}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </SessionContext.Provider>
  );
}
