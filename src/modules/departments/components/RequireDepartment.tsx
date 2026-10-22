import type { ReactNode } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useDepartmentAccess } from "@/hooks/useDepartmentAccess";
import { departmentAccess } from "@/lib/departments/access";
import { isDepartmentSlug } from "@/lib/departments/catalog";

/** Guarda de rota: bloqueia /departamentos/:slug sem acesso. */
export function RequireDepartment({ children }: { children: ReactNode }) {
  const { slug = "" } = useParams();
  const ctx = useDepartmentAccess();
  if (!isDepartmentSlug(slug) || departmentAccess(ctx, slug) === "none") {
    return <Navigate to="/departamentos" replace />;
  }
  return <>{children}</>;
}
