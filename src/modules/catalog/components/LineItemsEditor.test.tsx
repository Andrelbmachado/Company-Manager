// Itens do pedido em edição: clique no cabeçalho ordena (total pelo valor), Filtrar esconde linhas, e o número do
// item no rótulo dos campos continua o da lista gravada; digitar não faz a linha pular nem a gravação mudar de ordem.
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { click, renderPage, type as typeInto, type RenderedPage } from "@/test/pageHarness";
import { LineItemsEditor, newLine, type EditableLine } from "./LineItemsEditor";

const START: EditableLine[] = [
  newLine({ key: "a", description: "Switch", qty: "2", unitPrice: "2700" }),
  newLine({ key: "b", description: "Cabo", qty: "10", unitPrice: "15" }),
  newLine({ key: "c", description: "Mouse", qty: "3", unitPrice: "80" }),
];

let saved: EditableLine[] = START;

function Editor() {
  const [lines, setLines] = useState(START);
  return (
    <LineItemsEditor
      lines={lines}
      onChange={(next) => {
        saved = next;
        setLines(next);
      }}
      options={[]}
      suggestPrice={() => null}
    />
  );
}

let page: RenderedPage | null = null;
afterEach(() => {
  page?.unmount();
  page = null;
  saved = START;
});

const shown = () => [...page!.container.querySelectorAll<HTMLInputElement>("tbody tr input[aria-label^='Descrição do item']")].map((input) => `${input.getAttribute("aria-label")!.replace("Descrição do item ", "")}:${input.value}`);

describe("LineItemsEditor", () => {
  it("ordena pelo total, filtra pela descrição e mantém o número do item e a ordem gravada", async () => {
    page = await renderPage(<Editor />, { companyId: "empresa-1" });
    expect(shown()).toEqual(["1:Switch", "2:Cabo", "3:Mouse"]);

    await click(page.container.querySelector("th [data-sort-key='total']"));
    expect(shown()).toEqual(["2:Cabo", "3:Mouse", "1:Switch"]);

    await typeInto(page.container.querySelector("[aria-label='Descrição do item 2']"), "Cabo HDMI");
    expect(shown()).toEqual(["2:Cabo HDMI", "3:Mouse", "1:Switch"]);
    expect(saved.map((line) => line.description)).toEqual(["Switch", "Cabo HDMI", "Mouse"]);

    await click(page.button("Filtrar"));
    await typeInto(page.container.querySelector("[aria-label='Descrição: contém']"), "mou");
    expect(shown()).toEqual(["3:Mouse"]);
  });
});
