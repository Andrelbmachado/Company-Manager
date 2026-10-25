// Quem importa cada cadastro: a importação atualiza o registro que já existe (mesma chave), então exige `create` e
// `edit` no recurso, além de `create` em `imports`.
import { describe, expect, it } from "vitest";
import { can, ROLE_LABELS } from "@/lib/permissions/rbac";
import type { Role } from "@/types";
import { canImportEntity, importableEntities } from "./access";
import { getEntity, registry } from "./registry";

const ROLES = Object.keys(ROLE_LABELS) as Role[];

describe("canImportEntity", () => {
  it("quem só abre chamado (sem `edit` em tickets) não importa chamados: a planilha alteraria os chamados dos outros", () => {
    const tickets = getEntity("tickets")!;
    expect(can("comercial", "create", "tickets")).toBe(true);
    expect(can("comercial", "edit", "tickets")).toBe(false);
    expect(canImportEntity("comercial", tickets)).toBe(false);
    expect(importableEntities("comercial").map((entity) => entity.key)).not.toContain("tickets");
    expect(importableEntities("comercial").map((entity) => entity.key)).toContain("customers");
    expect(canImportEntity("gerente", tickets)).toBe(true);
  });

  it("todo cadastro importável pelo papel ele também pode criar e editar", () => {
    for (const role of ROLES) {
      for (const entity of Object.values(registry)) {
        if (!canImportEntity(role, entity)) continue;
        expect(can(role, "create", "imports"), `${role} → ${entity.key}`).toBe(true);
        expect(can(role, "create", entity.resource), `${role} → ${entity.key}`).toBe(true);
        expect(can(role, "edit", entity.resource), `${role} → ${entity.key}`).toBe(true);
      }
    }
  });
});
