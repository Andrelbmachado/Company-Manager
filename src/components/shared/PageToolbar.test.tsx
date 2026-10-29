// Barra de busca e filtros numa janela estreita (até 1/5 da largura da tela): os grupos quebram linha e a busca
// encolhe, em vez de alargar a página e criar rolagem lateral.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { PageToolbar } from "./PageToolbar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
});

const classes = (element: Element | null | undefined) => element?.getAttribute("class")?.split(/\s+/) ?? [];

describe("PageToolbar em janela estreita", () => {
  it("busca encolhe até a largura disponível e os grupos quebram linha", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <PageToolbar variant="page" search="" onSearchChange={() => {}} onFilterClick={() => {}}>
          <select aria-label="Segmento"><option>Todos</option></select>
          <button type="button">Exportar</button>
        </PageToolbar>,
      );
    });
    const bar = container.firstElementChild!;
    const [searchGroup, actionsGroup] = [...bar.children];
    for (const group of [searchGroup, actionsGroup]) {
      expect(classes(group)).toEqual(expect.arrayContaining(["flex-wrap", "min-w-0", "max-w-full"]));
    }
    const search = searchGroup.querySelector("label");
    expect(classes(search)).toEqual(expect.arrayContaining(["w-72", "max-w-full", "min-w-0"]));
    expect(search?.querySelector("input")).not.toBeNull();
  });
});
