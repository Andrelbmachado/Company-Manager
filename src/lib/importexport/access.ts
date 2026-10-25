// Quem pode importar e exportar cada cadastro: importar exige `create` em `imports` e no recurso do cadastro;
// exportar exige `export` no recurso (as mesmas regras do RBAC das telas).
import { can } from "@/lib/permissions/rbac";
import type { Role } from "@/types";
import { getEntity, registry, type ImportEntity } from "./registry";

export function canImportEntity(role: Role, entity: ImportEntity<unknown>): boolean {
  return can(role, "create", "imports") && can(role, "create", entity.resource);
}

export function canExportEntity(role: Role, entity: ImportEntity<unknown>): boolean {
  return Boolean(entity.exportData) && can(role, "export", entity.resource);
}

/**
 * Importação do histórico que o papel pode ver: só de cadastros que ele vê (os erros trazem CPF, valores e nomes da
 * planilha). Cadastro que não existe mais nesta versão: só quem importou.
 */
export function canSeeImportBatch(role: Role, batch: { entity: string; created_by?: string | null }, userId: string): boolean {
  const entity = getEntity(batch.entity);
  return entity ? can(role, "view", entity.resource) : Boolean(batch.created_by) && batch.created_by === userId;
}

/** Cadastros que o papel pode importar, em ordem alfabética do rótulo. */
export function importableEntities(role: Role): ImportEntity<unknown>[] {
  return Object.values(registry)
    .filter((entity) => canImportEntity(role, entity))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}

/** Rótulo do cadastro pela chave (histórico de importações). */
export function entityLabel(key: string): string {
  return getEntity(key)?.label ?? key;
}
