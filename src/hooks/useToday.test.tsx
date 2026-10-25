// "Hoje" de uma tela que fica aberta de um dia para o outro (o app desktop costuma passar a noite aberto no Dashboard).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToday } from "./useToday";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let renders = 0;

function Probe() {
  renders++;
  return <span>{useToday()}</span>;
}

beforeEach(() => {
  vi.useFakeTimers();
  // Horário local: 25/10/2026 às 23:59:30.
  vi.setSystemTime(new Date(2026, 9, 25, 23, 59, 30));
  renders = 0;
  container = document.createElement("div");
  root = createRoot(container);
  act(() => root.render(<Probe />));
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe("useToday", () => {
  it("vira o dia sozinho com a tela aberta, sem renderizar de novo enquanto o dia é o mesmo", () => {
    expect(container.textContent).toBe("2026-10-25");
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(container.textContent).toBe("2026-10-25");
    const before = renders;

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(container.textContent).toBe("2026-10-26");
    expect(renders).toBe(before + 1);
  });

  it("confere ao voltar o foco para a janela (o computador dormiu e o intervalo não rodou)", () => {
    vi.setSystemTime(new Date(2026, 9, 26, 8, 0, 0));
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(container.textContent).toBe("2026-10-26");
  });
});
