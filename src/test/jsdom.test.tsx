import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { EmptyState } from "@/components/shared/EmptyState";

// *.test.tsx roda em jsdom (vitest.config.ts): base para testes de componente.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

it("renderiza um componente compartilhado no jsdom", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<EmptyState title="Nenhum cliente" />);
  });
  expect(container.textContent).toContain("Nenhum cliente");
  act(() => root.unmount());
});
