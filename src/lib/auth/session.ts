import { Session } from "@/types";

const SESSION_KEY = "cm_session";

export function getSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function setSession(session: Session): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

export function requireSession(): Session {
  const s = getSession();
  if (!s) throw new Error("Não autenticado");
  return s;
}
