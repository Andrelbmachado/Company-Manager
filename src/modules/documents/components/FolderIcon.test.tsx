// Ícone de pasta chapado: uma cor (o texto atual), no máximo dois tons (corpo e aba), sem gradiente, sombra ou volume.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FolderIcon } from "./FolderIcon";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(element: JSX.Element) {
  act(() => root.render(element));
  return container.querySelector("svg")!;
}

describe("FolderIcon", () => {
  it.each([[<FolderIcon key="pasta" />], [<FolderIcon key="nuvem" cloud />]])("é chapado e monocromático (%#)", (element) => {
    const svg = render(element);
    expect(svg).not.toBeNull();
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(container.innerHTML).not.toMatch(/gradient|shadow|blur|drop-shadow|from-|via-|to-|blue|sky|indigo/i);
    expect(svg.querySelectorAll("linearGradient, radialGradient, filter, mask, image")).toHaveLength(0);
    const shapes = [...svg.querySelectorAll("path, rect")];
    const fills = new Set(shapes.map((shape) => shape.getAttribute("fill") ?? shape.getAttribute("class")));
    // Só a cor do texto (currentColor) e, no ícone de nuvem, o recorte na cor do fundo.
    for (const fill of fills) expect(["currentColor", "fill-background"]).toContain(fill);
    const tones = new Set(shapes.filter((shape) => shape.getAttribute("fill") === "currentColor").map((shape) => shape.getAttribute("opacity") ?? "1"));
    expect(tones.size).toBeLessThanOrEqual(2);
  });

  it("a variante de nuvem tem o recorte da nuvem; a comum, não", () => {
    expect(render(<FolderIcon cloud />).querySelector("[data-cloud-mark]")).not.toBeNull();
    expect(render(<FolderIcon />).querySelector("[data-cloud-mark]")).toBeNull();
  });
});
