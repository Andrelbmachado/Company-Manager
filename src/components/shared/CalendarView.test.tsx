// Calendário na tela (Mês / Semana / Dia, visual do Google Agenda): dias e horários no fuso de São Paulo, navegação
// com o período visível para quem carrega os eventos, abrir um evento e criar clicando num espaço vazio.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { click, findButton, renderPage, type RenderedPage } from "@/test/pageHarness";
import { CalendarView, type CalendarItem, type CalendarRange } from "./CalendarView";

// Domingo, 25/10/2026, 12:00 em São Paulo (15:00 UTC).
const NOW = new Date("2026-10-25T15:00:00Z");

const ITEMS: CalendarItem[] = [
  { id: "reuniao", title: "Reunião de equipe", start: "2026-10-26T12:00:00Z", end: "2026-10-26T13:00:00Z" }, // seg 09:00–10:00
  { id: "ferias", title: "Férias da Ana", start: "2026-10-27", end: "2026-10-30", allDay: true }, // ter a qui (fim exclusivo)
  { id: "plantao", title: "Plantão", start: "2026-10-31T02:30:00Z" }, // sex 23:30 em São Paulo (sábado em UTC)
];

let page: RenderedPage | null = null;
const onSelect = vi.fn();
const onCreate = vi.fn();
const onRangeChange = vi.fn((_range: CalendarRange) => {});

beforeEach(() => {
  onSelect.mockClear();
  onCreate.mockClear();
  onRangeChange.mockClear();
});

afterEach(() => {
  page?.unmount();
  page = null;
});

async function open(view: "month" | "week" | "day" = "month", items: CalendarItem[] = ITEMS) {
  page = await renderPage(<CalendarView items={items} view={view} now={NOW} onSelect={onSelect} onCreate={onCreate} onRangeChange={onRangeChange} />, { companyId: "empresa-1" });
  return page;
}

const grid = () => document.querySelector<HTMLElement>("[data-calendar-grid]");
const day = (key: string) => grid()?.querySelector<HTMLElement>(`[data-day='${key}']`) ?? null;
const itemsIn = (key: string) => [...(day(key)?.querySelectorAll<HTMLElement>("[data-item-id]") ?? [])].map((item) => item.dataset.itemId);
const title = () => document.querySelector("h2")?.textContent;

describe("CalendarView", () => {
  it("mês: 6 semanas de domingo a sábado, hoje marcado e eventos no dia de São Paulo (fim exclusivo no dia inteiro)", async () => {
    await open("month");
    expect(grid()?.dataset.calendarGrid).toBe("month");
    expect(title()).toBe("Outubro de 2026");
    const days = [...grid()!.querySelectorAll<HTMLElement>("[data-day]")].map((cell) => cell.dataset.day);
    expect(days).toHaveLength(42);
    expect(days[0]).toBe("2026-09-27");
    expect(day("2026-10-25")?.querySelector("[aria-current=date]")).not.toBeNull();

    expect(itemsIn("2026-10-26")).toEqual(["reuniao"]);
    expect(day("2026-10-26")?.textContent).toContain("09:00");
    expect(["2026-10-27", "2026-10-28", "2026-10-29"].map(itemsIn)).toEqual([["ferias"], ["ferias"], ["ferias"]]);
    expect(itemsIn("2026-10-30")).toEqual(["plantao"]);
    expect(itemsIn("2026-10-31")).toEqual([]);
  });

  it("avisa o período visível ao abrir e ao navegar (fim exclusivo), com o título do período", async () => {
    await open("month");
    expect(onRangeChange).toHaveBeenLastCalledWith({ start: "2026-09-27", end: "2026-11-08" });

    await click(findButton(document.body, "Próximo mês"));
    expect(title()).toBe("Novembro de 2026");
    expect(onRangeChange).toHaveBeenLastCalledWith({ start: "2026-11-01", end: "2026-12-13" });

    await click(findButton(document.body, "Semana"));
    expect(grid()?.dataset.calendarGrid).toBe("week");
    expect(onRangeChange).toHaveBeenLastCalledWith({ start: "2026-11-01", end: "2026-11-08" });

    await click(findButton(document.body, "Hoje"));
    expect(title()).toBe("25 – 31 de outubro de 2026");
    expect(onRangeChange).toHaveBeenLastCalledWith({ start: "2026-10-25", end: "2026-11-01" });
  });

  it("dia cheio mostra os primeiros e '+N mais', que abre o dia; clicar no evento chama onSelect", async () => {
    const busy: CalendarItem[] = ["a", "b", "c", "d"].map((id, index) => ({ id, title: `Evento ${id}`, start: `2026-10-28T1${index}:00:00Z` }));
    await open("month", busy);
    expect(itemsIn("2026-10-28")).toEqual(["a", "b"]);
    expect(day("2026-10-28")?.textContent).toContain("+2 mais");

    await click(day("2026-10-28")?.querySelector("[data-item-id='b']"));
    expect(onSelect).toHaveBeenCalledWith(busy[1]);

    await click(findButton(day("2026-10-28")!, "+2 mais"));
    expect(document.querySelector("[data-calendar-view]")?.getAttribute("data-calendar-view")).toBe("day");
    expect(title()).toBe("Quarta-feira, 28 de outubro de 2026");
    expect(itemsIn("2026-10-28")).toEqual(["a", "b", "c", "d"]);
  });

  it("clicar num dia vazio do mês cria evento de dia inteiro", async () => {
    await open("month");
    await click(day("2026-10-14"));
    expect(onCreate).toHaveBeenCalledWith("2026-10-14", { allDay: true });
  });

  it("semana: dia inteiro na faixa do topo, evento com horário na coluna e altura certas, 23:30 de sexta fica na sexta", async () => {
    await open("week");
    expect(title()).toBe("25 – 31 de outubro de 2026");
    const ferias = grid()!.querySelector<HTMLElement>("[data-item-id='ferias']")!;
    expect(day("2026-10-27")?.contains(ferias)).toBe(false);
    // Terça (coluna 2 de 7) cobrindo 3 dias; o jsdom arredonda a porcentagem.
    expect(ferias.style.left).toMatch(/^calc\(28\.57\d*% \+ 2px\)$/);
    expect(ferias.style.width).toMatch(/^calc\(42\.857\d*% - 4px\)$/);

    const reuniao = day("2026-10-26")!.querySelector<HTMLElement>("[data-item-id='reuniao']")!;
    expect(reuniao.style.top).toBe(`${9 * 48 + 1}px`);
    expect(reuniao.style.height).toBe(`${48 - 2}px`);
    expect(itemsIn("2026-10-30")).toEqual(["plantao"]);
    expect(day("2026-10-30")!.querySelector<HTMLElement>("[data-item-id='plantao']")!.style.top).toBe(`${23.5 * 48 + 1}px`);
  });

  it("clicar num horário vazio da semana cria no instante UTC daquele horário em São Paulo (meia em meia hora)", async () => {
    await open("week");
    const monday = day("2026-10-26")!;
    await act(async () => {
      monday.dispatchEvent(new MouseEvent("click", { bubbles: true, clientY: 9 * 48 + 30 }));
    });
    expect(onCreate).toHaveBeenCalledWith("2026-10-26T12:30:00.000Z", { allDay: false });
  });

  it("cabeçalho do dia na semana abre a visão Dia", async () => {
    await open("week");
    const header = [...grid()!.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Seg26");
    await click(header);
    expect(grid()?.dataset.calendarGrid).toBe("day");
    expect(title()).toBe("Segunda-feira, 26 de outubro de 2026");
    expect(itemsIn("2026-10-26")).toEqual(["reuniao"]);
    expect(onRangeChange).toHaveBeenLastCalledWith({ start: "2026-10-26", end: "2026-10-27" });
  });
});
