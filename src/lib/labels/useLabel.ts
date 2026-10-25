// Rótulos da área da empresa na interface: `useLabel("dashboard.active_work")` ou, para vários,
// `const { label } = useAreaLabels()`. Enquanto carrega (ou se a leitura falhar), vale o texto do perfil padrão,
// nunca texto vazio. Depois de gravar em Configurações, invalide `areaLabelsQueryKey(companyId)`.
import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRequiredSession } from "@/hooks/useSession";
import { getDb } from "@/lib/db/client";
import { DEFAULT_AREA_PROFILE, labelFor, type AreaProfile, type LabelKey } from "./profiles";
import { loadAreaLabels } from "./store";

export function areaLabelsQueryKey(companyId: string) {
  return ["settings", companyId, "area-labels"] as const;
}

const NO_OVERRIDES: Record<string, string> = {};

export interface AreaLabels {
  profile: AreaProfile;
  overrides: Record<string, string>;
  /** Rótulo da chave (sobrescrita → perfil → padrão → a própria chave). */
  label: (key: LabelKey | (string & {})) => string;
  loading: boolean;
}

export function useAreaLabels(): AreaLabels {
  const companyId = useRequiredSession().company.id;
  const query = useQuery({
    queryKey: areaLabelsQueryKey(companyId),
    queryFn: async () => loadAreaLabels(await getDb(), companyId),
    staleTime: 5 * 60_000,
  });
  const profile = query.data?.profile ?? DEFAULT_AREA_PROFILE;
  const overrides = query.data?.overrides ?? NO_OVERRIDES;
  const label = useCallback((key: string) => labelFor(key, profile, overrides), [profile, overrides]);
  return { profile, overrides, label, loading: query.isLoading };
}

/** Rótulo de uma chave para a empresa da sessão. */
export function useLabel(key: LabelKey | (string & {})): string {
  return useAreaLabels().label(key);
}
