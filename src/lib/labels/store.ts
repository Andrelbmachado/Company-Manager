// Leitura e gravação do perfil de área e dos rótulos personalizados (tabela settings).
// Gravar exige `edit` em `settings` (CEO e Administração): a camada de dados barra, não só a tela.
import type { DatabaseLike } from "@/lib/db/demo";
import { can } from "@/lib/permissions/rbac";
import { getCompanySetting, setCompanySetting } from "@/lib/settings/companySettings";
import type { Role } from "@/types";
import { AREA_PROFILES, parseAreaProfile, parseLabelOverrides, type AreaProfile } from "./profiles";

export const AREA_PROFILE_SETTING = "company.area_profile";
export const LABELS_SETTING = "company.labels";

export interface AreaLabelSettings {
  profile: AreaProfile;
  overrides: Record<string, string>;
}

export interface AreaLabelChanges {
  profile?: AreaProfile;
  /** Substitui todas as sobrescritas (objeto vazio volta tudo ao texto do perfil). */
  overrides?: Record<string, string>;
}

export async function loadAreaLabels(db: DatabaseLike, companyId: string): Promise<AreaLabelSettings> {
  const [profile, overrides] = await Promise.all([getCompanySetting(db, companyId, AREA_PROFILE_SETTING), getCompanySetting(db, companyId, LABELS_SETTING)]);
  return { profile: parseAreaProfile(profile), overrides: parseLabelOverrides(overrides) };
}

/** Grava o que mudou e devolve o estado gravado. */
export async function saveAreaLabels(
  db: DatabaseLike,
  companyId: string,
  actor: { role: Role; userId: string },
  changes: AreaLabelChanges,
): Promise<AreaLabelSettings> {
  if (!can(actor.role, "edit", "settings")) throw new Error("Sem permissão para mudar a área da empresa e os rótulos.");
  if (changes.profile !== undefined && !AREA_PROFILES.includes(changes.profile)) throw new Error(`Área da empresa desconhecida: ${String(changes.profile)}.`);
  if (changes.profile !== undefined) await setCompanySetting(db, companyId, AREA_PROFILE_SETTING, changes.profile);
  if (changes.overrides !== undefined) await setCompanySetting(db, companyId, LABELS_SETTING, parseLabelOverrides(changes.overrides));
  return loadAreaLabels(db, companyId);
}
