import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { useRequiredSession } from "@/hooks/useSession";
import { accessContextFromSession } from "@/hooks/useDepartmentAccess";
import { canDepartment, departmentAccess, membershipFor, visibleCards } from "@/lib/departments/access";
import { getDepartment, type DepartmentSlug } from "@/lib/departments/catalog";
import { listTeamAbsences } from "@/lib/departments/repository";
import { formatDate } from "@/lib/utils";
import { DepartmentIcon } from "../components/DepartmentIcon";

const ROLE_LABEL = { chefe: "Chefe", assistente: "Assistente", membro: "Membro" } as const;

export default function DepartmentPage() {
  const { slug } = useParams();
  const session = useRequiredSession();
  const ctx = accessContextFromSession(session);
  const dept = getDepartment(slug ?? "")!; // garantido por RequireDepartment
  const owner = dept.slug as DepartmentSlug;
  const access = departmentAccess(ctx, owner);
  const cards = visibleCards(ctx, owner);
  const myRole = membershipFor(ctx, owner)?.role;
  const showAbsences = cards.some((c) => c.resource === "ferias_ausencias");

  const { data: absences = [] } = useQuery({
    queryKey: ["absences", session.company.id, owner],
    queryFn: () => listTeamAbsences(ctx, session.company.id),
    enabled: showAbsences && "__TAURI_INTERNALS__" in window,
  });

  return (
    <div>
      <PageHeader
        title={dept.name}
        description={dept.description}
        actions={
          <span className="rounded-full border px-3 py-1 text-xs text-muted-foreground">
            {access === "full" ? "Administrador" : access === "shared" ? "Somente leitura (compartilhado)" : ROLE_LABEL[myRole!]}
          </span>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => {
          const canEdit = canDepartment(ctx, owner, "edit", card.resource);
          return (
            <div key={card.resource} className="rounded-xl border bg-card p-5 shadow-sm flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{card.title}</span>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <DepartmentIcon name={card.icon} size={16} />
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{card.description}</p>
              <span className="mt-auto text-[10px] uppercase tracking-wider text-muted-foreground/70">
                {canEdit ? "Gerenciar" : "Visualizar"}
              </span>
            </div>
          );
        })}
      </div>

      {showAbsences && (
        <div className="mt-6 rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="text-sm font-semibold">Férias e ausências do time</h2>
          {absences.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">Nenhuma ausência registrada.</p>
          ) : (
            <ul className="mt-3 divide-y text-sm">
              {absences.map((a, i) => (
                <li key={a.id ?? i} className="flex justify-between py-2">
                  <span>{a.colaborador_nome} · <span className="text-muted-foreground">{a.tipo}</span></span>
                  <span className="text-muted-foreground">{formatDate(a.data_inicio)} – {formatDate(a.data_fim)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
