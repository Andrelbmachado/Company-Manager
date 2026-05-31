import { useState } from "react";
import { BrowserRouter } from "react-router-dom";
import { SessionContext } from "@/hooks/useSession";
import { AppRoutes } from "./routes";
import { getSession } from "@/lib/auth/session";
import type { Session } from "@/types";

export default function App() {
  const [session, setSession] = useState<Session | null>(() => getSession());

  return (
    <SessionContext.Provider value={{ session, setSession }}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </SessionContext.Provider>
  );
}
