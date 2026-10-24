// TEMPORÁRIO: botões flutuantes nas laterais da tela de login para entrar direto como cada área.
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { DEV_AREAS, DEV_QUICK_LOGIN, devQuickLogin } from "@/lib/dev/quickLogin";
import type { Role, Session } from "@/types";

interface Props {
  onSession: (session: Session) => void;
  onError: (message: string) => void;
}

const pill = "pointer-events-auto flex h-8 w-[5.5rem] items-center justify-center gap-1 rounded-full border bg-card/80 text-xs font-medium text-muted-foreground opacity-70 shadow-sm backdrop-blur hover:opacity-100 hover:text-foreground disabled:cursor-wait";

export function DevQuickLogin({ onSession, onError }: Props) {
  const [busy, setBusy] = useState<Role | null>(null);
  if (!DEV_QUICK_LOGIN) return null;

  async function enter(role: Role) {
    setBusy(role);
    onError("");
    try {
      onSession(await devQuickLogin(role));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Não foi possível entrar nessa área.");
    } finally {
      setBusy(null);
    }
  }

  const column = (areas: typeof DEV_AREAS, side: "left-3" | "right-3") => (
    <div className={`pointer-events-none fixed ${side} top-1/2 z-50 flex -translate-y-1/2 flex-col gap-1.5`}>
      {areas.map((area) => (
        <button key={area.role} type="button" disabled={busy !== null} onClick={() => enter(area.role)} title={`Entrar como ${area.label} (${area.name})`} aria-label={`Entrar rápido como ${area.label}`} className={pill}>
          {busy === area.role && <Loader2 size={12} className="animate-spin" />}
          {area.label}
        </button>
      ))}
    </div>
  );

  return (
    <>
      {column(DEV_AREAS.slice(0, 6), "left-3")}
      {column(DEV_AREAS.slice(6), "right-3")}
    </>
  );
}
