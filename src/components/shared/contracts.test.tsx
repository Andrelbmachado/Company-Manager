// Contratos de componentes compartilhados que as telas já usam antes da implementação completa.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionContext } from "@/hooks/useSession";
import type { Session } from "@/types";
import { FileAttachments } from "./FileAttachments";
import { ImportExportButtons } from "./ImportExportButtons";

describe("componentes compartilhados provisórios", () => {
  it("ImportExportButtons: ativos conforme a permissão; fora da sessão ou cadastro sem importação, desativados com o motivo", () => {
    const withRole = (role: string, entity: string) => {
      const session = { user: { id: "u-1" }, membership: { role }, company: { id: "c-1" } } as unknown as Session;
      return renderToStaticMarkup(
        <SessionContext.Provider value={{ session, setSession: () => undefined }}>
          <ImportExportButtons entity={entity} onImported={() => undefined} />
        </SessionContext.Provider>,
      );
    };
    const outside = renderToStaticMarkup(<ImportExportButtons entity="customers" onImported={() => undefined} />);
    expect(outside).toContain("Importar");
    expect(outside).toContain("Exportar");
    expect(outside.match(/disabled=""/g)).toHaveLength(2);
    expect(outside).toContain('data-entity="customers"');

    const ceo = withRole("ceo", "customers");
    expect(ceo).toContain("Importar");
    expect(ceo).toContain("Exportar");
    expect(ceo).not.toContain('disabled=""');

    // Auditor exporta fornecedores, mas não importa; atendimento não importa nem exporta contas a pagar.
    const auditor = withRole("auditor", "suppliers");
    expect(auditor).not.toContain(">Importar");
    expect(auditor).toContain("Exportar");
    expect(withRole("atendimento", "payables")).toBe("");

    const unknown = withRole("ceo", "nada");
    expect(unknown.match(/disabled=""/g)).toHaveLength(2);
    expect(unknown).toContain("Este cadastro não tem importação");
  });

  it("FileAttachments mostra o estado vazio de anexos", () => {
    const html = renderToStaticMarkup(<FileAttachments entityType="customer" entityId="c-1" canEdit />);
    expect(html).toContain("Anexos em breve");
    expect(html).toContain('data-entity-id="c-1"');
  });
});
