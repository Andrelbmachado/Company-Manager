import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRequiredSession } from "./useSession";
import { ensureSiteProspectingSeed } from "@/lib/prospecting/seed";
import { can } from "@/lib/permissions/rbac";
import type { Role } from "@/types";

/** Importa o projeto "Desenvolvimento de Site" (leads, pacotes, previsão) na 1ª sessão de quem pode criar leads. */
export function useProspectingBootstrap(): void {
  const session = useRequiredSession();
  const qc = useQueryClient();
  const canSeed = can(session.membership.role as Role, "create", "leads");

  useEffect(() => {
    if (!canSeed) return;
    ensureSiteProspectingSeed(session)
      .then((imported) => {
        if (!imported) return;
        // dashboard-kpis: o Dashboard costuma estar aberto no primeiro login e conta o projeto novo em "Projetos ativos".
        for (const key of ["projects", "tasks", "pm", "leads", "service-packages", "package-prices", "revenue-scenarios", "revenue-forecasts", "dashboard-kpis"]) {
          qc.invalidateQueries({ queryKey: [key] });
        }
      })
      .catch((error) => console.error("[prospecting] seed failed", error));
    // session é estável por login; company/user definem o escopo do seed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.company.id, session.user.id, canSeed, qc]);
}
