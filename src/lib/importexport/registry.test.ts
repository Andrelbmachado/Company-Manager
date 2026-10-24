// Contrato do registro de importação: cada importers/<chave>.ts exporta `entity` com a mesma chave do arquivo.
import { describe, expect, it } from "vitest";
import { RESOURCES } from "@/lib/permissions/rbac";
import { importerFileKey, importerFiles, registry } from "./registry";

describe("registro de importação", () => {
  it("cada importer exporta `entity` com a chave do nome do arquivo, recurso do RBAC e campos únicos", () => {
    for (const [file, module] of Object.entries(importerFiles)) {
      expect(module.entity, `${file} exporta entity`).toBeTruthy();
      const entity = module.entity!;
      expect(entity.key, file).toBe(importerFileKey(file));
      expect(RESOURCES, file).toContain(entity.resource);
      const keys = entity.fields.map((field) => field.key);
      expect(new Set(keys).size, `${file}: campos repetidos`).toBe(keys.length);
      expect(registry[entity.key]).toBe(entity);
    }
    expect(Object.keys(registry).sort()).toEqual(Object.keys(importerFiles).map(importerFileKey).sort());
  });

  it("chave do arquivo", () => {
    expect(importerFileKey("./importers/customers.ts")).toBe("customers");
  });
});
