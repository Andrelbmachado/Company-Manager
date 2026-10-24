// Contratos de componentes compartilhados que as telas já usam antes da implementação completa.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FileAttachments } from "./FileAttachments";
import { ImportExportButtons } from "./ImportExportButtons";

describe("componentes compartilhados provisórios", () => {
  it("ImportExportButtons mostra Importar e Exportar desativados com o título Em breve", () => {
    const html = renderToStaticMarkup(<ImportExportButtons entity="customers" onImported={() => undefined} />);
    expect(html).toContain("Importar");
    expect(html).toContain("Exportar");
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html.match(/title="Em breve"/g)).toHaveLength(2);
    expect(html).toContain('data-entity="customers"');
  });

  it("FileAttachments mantém o contrato (entityType, entityId, canEdit, className) dentro da sessão", async () => {
    // Comportamento completo em FileAttachments.test.tsx; aqui só a forma que as telas já usam.
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { SessionContext } = await import("@/hooks/useSession");
    const session = { user: { id: "u-1" }, membership: { role: "comercial" }, company: { id: "empresa-1" } } as unknown as import("@/types").Session;
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <SessionContext.Provider value={{ session, setSession: () => undefined }}>
          <FileAttachments entityType="customer" entityId="c-1" canEdit className="mt-4" />
        </SessionContext.Provider>
      </QueryClientProvider>,
    );
    expect(html).toContain("Anexos");
    expect(html).toContain("Enviar arquivos");
    expect(html).toContain('data-entity-type="customer"');
    expect(html).toContain('data-entity-id="c-1"');
  });
});
