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

  it("FileAttachments mostra o estado vazio de anexos", () => {
    const html = renderToStaticMarkup(<FileAttachments entityType="customer" entityId="c-1" canEdit />);
    expect(html).toContain("Anexos em breve");
    expect(html).toContain('data-entity-id="c-1"');
  });
});
