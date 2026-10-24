import { Link, useLocation } from "react-router-dom";
import { useRequiredSession } from "@/hooks/useSession";
import { cn } from "@/lib/utils";
import type { Role } from "@/types";
import { activeNavPath, moduleNavItems, sectionForPath } from "../subpages";

/**
 * Abas do módulo atual (raiz + subpáginas de lista que o papel abre), acima da página. A seção vem da URL e as
 * abas, do registro em src/app/subpages.ts. Some quando o módulo não tem subpágina visível para o papel.
 */
export function ModuleNav() {
  const { pathname } = useLocation();
  const session = useRequiredSession();
  const section = sectionForPath(pathname);
  if (!section) return null;
  const items = moduleNavItems(session.membership.role as Role, section.module);
  if (items.length < 2) return null;
  const active = activeNavPath(items.map((item) => item.path), pathname);

  return (
    <nav aria-label={`Seções de ${section.title}`} className="mb-6 flex gap-1 overflow-x-auto border-b">
      {items.map((item) => {
        const current = item.path === active;
        return (
          <Link
            key={item.path}
            to={item.path}
            aria-current={current ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors",
              current ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
