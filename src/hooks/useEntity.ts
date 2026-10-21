import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRequiredSession } from "./useSession";
import { insertEntities, listEntity, listRefOptions, updateEntity, type Row } from "@/lib/data/repository";
import type { EntityKey } from "@/lib/data/entities";

export const entityQueryKey = (key: EntityKey, companyId: string) => ["entity", key, companyId] as const;

export function useEntityList(key: EntityKey) {
  const session = useRequiredSession();
  return useQuery({
    queryKey: entityQueryKey(key, session.company.id),
    queryFn: () => listEntity(key, session.company.id),
  });
}

export function useRefOptions(key: EntityKey | undefined) {
  const session = useRequiredSession();
  return useQuery({
    queryKey: ["entity-ref", key, session.company.id],
    queryFn: () => listRefOptions(key!, session.company.id),
    enabled: !!key,
  });
}

/** Invalidate every entity list (refs and dashboard KPIs depend on each other). */
export function useInvalidateEntities() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["entity"] });
    qc.invalidateQueries({ queryKey: ["entity-ref"] });
    qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
  };
}

export function useCreateEntity(key: EntityKey) {
  const session = useRequiredSession();
  const invalidate = useInvalidateEntities();
  return useMutation({
    mutationFn: (rows: Row[]) => insertEntities(key, session, rows),
    onSuccess: invalidate,
  });
}

export function useUpdateEntity(key: EntityKey) {
  const session = useRequiredSession();
  const invalidate = useInvalidateEntities();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Row }) => updateEntity(key, session, id, patch),
    onSuccess: invalidate,
  });
}
