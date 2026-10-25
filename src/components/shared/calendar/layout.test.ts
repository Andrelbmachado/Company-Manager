// Cálculo do calendário (sem React): semana de domingo a sábado, dias e horários no fuso de São Paulo
// (independe do fuso da máquina), eventos sobrepostos em colunas e dia inteiro na faixa do topo.
import { describe, expect, it } from "vitest";
import type { CalendarItem } from "../CalendarView";
import { APP_TIME_ZONE, addDays, layoutDay, layoutWeek, monthGridDays, normalizeItem, startOfWeek, todayIn, weekStartFor, zonedInstant } from "./layout";

const timed = (id: string, start: string, end?: string): CalendarItem => ({ id, title: id, start, end });

describe("datas do calendário", () => {
  it("semana começa no domingo", () => {
    expect(startOfWeek("2026-10-25")).toBe("2026-10-25");
    expect(startOfWeek("2026-10-28")).toBe("2026-10-25");
    expect(startOfWeek("2026-10-31")).toBe("2026-10-25");
    expect(startOfWeek("2026-11-01")).toBe("2026-11-01");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("o dia de hoje e o início da semana vêm do fuso de São Paulo, não do UTC", () => {
    expect(APP_TIME_ZONE).toBe("America/Sao_Paulo");
    // 01:00 UTC de domingo = 22:00 de sábado em São Paulo: ainda é a semana anterior.
    const saturdayNight = new Date("2026-10-25T01:00:00Z");
    expect(todayIn(saturdayNight)).toBe("2026-10-24");
    expect(weekStartFor(saturdayNight)).toBe("2026-10-18");
    expect(weekStartFor(new Date("2026-10-25T03:00:00Z"))).toBe("2026-10-25");
  });

  it("grade do mês: 6 semanas começando no domingo", () => {
    const days = monthGridDays("2026-10-15");
    expect(days).toHaveLength(42);
    expect(days[0]).toBe("2026-09-27");
    expect(days[41]).toBe("2026-11-07");
  });

  it("horário de parede em São Paulo vira o instante UTC certo", () => {
    expect(zonedInstant("2026-10-25", 9 * 60)).toBe("2026-10-25T12:00:00.000Z");
    expect(zonedInstant("2026-10-25", 23 * 60 + 30)).toBe("2026-10-26T02:30:00.000Z");
  });

  it("instante ISO, horário sem fuso com T (campo datetime-local) e datetime do SQLite (UTC)", () => {
    expect(normalizeItem(timed("a", "2026-10-26T12:00:00.000Z"))).toMatchObject({ allDay: false, startDay: "2026-10-26", startMinute: 540 });
    expect(normalizeItem(timed("b", "2026-10-26T14:00"))).toMatchObject({ startDay: "2026-10-26", startMinute: 840 });
    expect(normalizeItem(timed("c", "2026-10-26 17:00:00"))).toMatchObject({ startDay: "2026-10-26", startMinute: 840 });
    expect(normalizeItem(timed("d", "2026-10-26T09:00:00-03:00"))).toMatchObject({ startDay: "2026-10-26", startMinute: 540 });
    expect(normalizeItem({ id: "e", title: "e", start: "2026-10-26", allDay: true })).toMatchObject({ allDay: true, startDay: "2026-10-26", endDay: "2026-10-26" });
  });
});

describe("layoutWeek", () => {
  const WEEK = "2026-10-25";

  it("dois eventos sobrepostos ficam em colunas diferentes; o seguinte, que só encosta, volta à coluna 0", () => {
    const placed = layoutWeek(
      [
        timed("a", "2026-10-26T12:00:00Z", "2026-10-26T13:00:00Z"), // 09:00–10:00
        timed("b", "2026-10-26T12:30:00Z", "2026-10-26T14:00:00Z"), // 09:30–11:00
        timed("c", "2026-10-26T14:00:00Z", "2026-10-26T15:00:00Z"), // 11:00–12:00
      ],
      WEEK,
    );
    const byId = Object.fromEntries(placed.map((item) => [item.item.id, item]));
    expect(byId.a).toMatchObject({ allDay: false, dayIndex: 1, startMinute: 540, endMinute: 600, column: 0, columns: 2 });
    expect(byId.b).toMatchObject({ dayIndex: 1, startMinute: 570, endMinute: 660, column: 1, columns: 2 });
    expect(byId.c).toMatchObject({ dayIndex: 1, startMinute: 660, column: 0, columns: 1 });
  });

  it("três eventos encadeados no mesmo grupo dividem a largura pelo maior número de colunas", () => {
    const placed = layoutWeek(
      [
        timed("a", "2026-10-27T12:00:00Z", "2026-10-27T15:00:00Z"), // 09–12
        timed("b", "2026-10-27T12:00:00Z", "2026-10-27T13:00:00Z"), // 09–10
        timed("c", "2026-10-27T13:00:00Z", "2026-10-27T14:00:00Z"), // 10–11, reaproveita a coluna de b
      ],
      WEEK,
    );
    const byId = Object.fromEntries(placed.map((item) => [item.item.id, item]));
    expect(byId.a.column).toBe(0);
    expect(byId.b.column).toBe(1);
    expect(byId.c.column).toBe(1);
    expect(new Set(placed.map((item) => item.columns))).toEqual(new Set([2]));
  });

  it("evento de dia inteiro vai para a faixa do topo, cortado na semana e com fim exclusivo", () => {
    const placed = layoutWeek(
      [
        { id: "folga", title: "Folga", start: "2026-10-27", allDay: true },
        { id: "ferias", title: "Férias", start: "2026-10-22", end: "2026-10-28", allDay: true },
        timed("plantao", "2026-10-29T12:00:00Z", "2026-10-31T12:00:00Z"), // 48 h: também no topo
      ],
      WEEK,
    );
    const byId = Object.fromEntries(placed.map((item) => [item.item.id, item]));
    expect(byId.folga).toMatchObject({ allDay: true, dayIndex: 2, span: 1 });
    expect(byId.ferias).toMatchObject({ allDay: true, dayIndex: 0, span: 3 });
    expect(byId.plantao).toMatchObject({ allDay: true, dayIndex: 4, span: 3 });
    expect(byId.folga.row).not.toBe(byId.ferias.row);
  });

  it("respeita America/Sao_Paulo: sábado 23h local (domingo em UTC) fica fora da semana; sábado 22h30 é o último dia", () => {
    const placed = layoutWeek(
      [
        timed("semana-passada", "2026-10-25T02:00:00Z", "2026-10-25T02:30:00Z"),
        timed("sabado", "2026-11-01T01:30:00Z", "2026-11-01T02:00:00Z"),
      ],
      WEEK,
    );
    expect(placed.map((item) => item.item.id)).toEqual(["sabado"]);
    expect(placed[0]).toMatchObject({ dayIndex: 6, startMinute: 22 * 60 + 30, endMinute: 23 * 60 });
  });

  it("evento que passa da meia-noite aparece nos dois dias; sem fim vira 30 minutos", () => {
    const placed = layoutWeek([timed("noite", "2026-10-26T01:00:00Z", "2026-10-26T05:00:00Z"), timed("lembrete", "2026-10-28T13:00:00Z")], WEEK);
    const night = placed.filter((item) => item.item.id === "noite");
    expect(night.map((item) => [item.dayIndex, item.startMinute, item.endMinute])).toEqual([
      [0, 22 * 60, 24 * 60],
      [1, 0, 2 * 60],
    ]);
    expect(placed.find((item) => item.item.id === "lembrete")).toMatchObject({ dayIndex: 3, startMinute: 600, endMinute: 630 });
  });

  it("layoutDay é a mesma conta com um dia só", () => {
    const placed = layoutDay([timed("a", "2026-10-26T12:00:00Z", "2026-10-26T13:00:00Z"), timed("b", "2026-10-27T12:00:00Z")], "2026-10-26");
    expect(placed.map((item) => [item.item.id, item.dayIndex])).toEqual([["a", 0]]);
  });
});
