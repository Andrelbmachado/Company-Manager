import { Link } from "react-router-dom";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { useDepartmentAccess } from "@/hooks/useDepartmentAccess";
import { visibleDepartments } from "@/lib/departments/access";
import { DepartmentIcon } from "../components/DepartmentIcon";
import { Building2 } from "lucide-react";

const ACCESS_LABEL = { full: "Admin", own: "Meu departamento", shared: "Compartilhado", none: "" } as const;

export default function DepartmentsIndexPage() {
  const ctx = useDepartmentAccess();
  const depts = visibleDepartments(ctx);

  return (
    <div>
      <PageHeader title="Departamentos" description="Cada área da empresa com seu próprio espaço de trabalho." />
      {depts.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Você ainda não faz parte de nenhum departamento"
          description="Peça ao administrador para vincular sua conta a um departamento."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {depts.map((d) => (
            <Link
              key={d.slug}
              to={`/departamentos/${d.slug}`}
              className="group rounded-xl border bg-card p-5 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
            >
              <div className="flex items-center justify-between">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <DepartmentIcon name={d.icon} size={18} />
                </span>
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {ACCESS_LABEL[d.access]}
                </span>
              </div>
              <h3 className="mt-4 text-sm font-semibold">{d.name}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{d.description}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
