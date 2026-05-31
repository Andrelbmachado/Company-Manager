import { createContext, useContext } from "react";
import type { Session } from "@/types";

export interface SessionContextValue {
  session: Session | null;
  setSession: (s: Session | null) => void;
}

export const SessionContext = createContext<SessionContextValue>({
  session: null,
  setSession: () => {},
});

export function useSession(): SessionContextValue {
  return useContext(SessionContext);
}

export function useRequiredSession(): Session {
  const { session } = useSession();
  if (!session) throw new Error("No session");
  return session;
}
