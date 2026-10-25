import { describe, expect, it } from "vitest";
import { CLOUD_FULL_ACCESS_ROLES } from "@/lib/files/cloudFolders";
import { ROLE_LABELS } from "@/lib/permissions/rbac";
import type { Role } from "@/types";
import { canSeeFolder, defaultRoot, visibleRoots } from "./access";

describe("pastas por setor", () => {
  it("compara o nome da pasta raiz sem acento e sem diferenciar maiúsculas (dados do desktop têm acento)", () => {
    expect(canSeeFolder("tecnico", "TI e Operações/Relatórios")).toBe(true);
    expect(canSeeFolder("tecnico", "TI e Operacoes")).toBe(true);
    expect(canSeeFolder("tecnico", "ti e operações")).toBe(true);
    expect(canSeeFolder("tecnico", "Financeiro/Fechamentos")).toBe(false);
    expect(canSeeFolder("rh", "Recursos Humanos/Políticas")).toBe(true);
    expect(canSeeFolder("comercial", "Compartilhados/Guias")).toBe(true);
  });

  it("acesso total vê tudo, inclusive a raiz; setor não vê arquivo solto na raiz", () => {
    for (const role of ["ceo", "admin", "gerente", "auditor"] as const) {
      expect(canSeeFolder(role, "")).toBe(true);
      expect(canSeeFolder(role, "Diretoria/Contratos")).toBe(true);
    }
    expect(canSeeFolder("estoquista", "")).toBe(false);
  });

  it("envio na raiz vai para a pasta do setor (ou Compartilhados)", () => {
    expect(defaultRoot("ceo")).toBe("Compartilhados");
    expect(defaultRoot("financeiro")).toBe("Financeiro");
    expect(defaultRoot("tecnico")).toBe("TI e Operações");
    expect(visibleRoots("produtos")).toEqual(["Desenvolvimento de Produtos", "Compartilhados"]);
    expect(visibleRoots("ceo")).toBe("*");
  });

  it("quem vê todas as pastas também vê todas as pastas de nuvem conectadas (mesma lista nos dois lugares)", () => {
    expect((Object.keys(ROLE_LABELS) as Role[]).filter((role) => visibleRoots(role) === "*").sort()).toEqual([...CLOUD_FULL_ACCESS_ROLES].sort());
  });
});
