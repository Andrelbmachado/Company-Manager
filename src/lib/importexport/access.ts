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
