// Dia local de instantes UTC (closed_at, updated_at) usado no funil.
import { describe, expect, it } from "vitest";
import { todayIso } from "@/lib/utils";
import { localDay } from "./format";

describe("localDay", () => {
  it("converte o instante UTC para o dia do fuso local, no formato ISO ou no datetime('now') do SQLite", () => {
    const instant = new Date("2026-11-01T01:30:00.000Z");
    expect(localDay("2026-11-01T01:30:00.000Z")).toBe(todayIso(instant));
    expect(localDay("2026-11-01 01:30:00")).toBe(todayIso(instant));
    expect(localDay("2026-10-31T22:30:00-03:00")).toBe(todayIso(instant));
  });

  it("data pura passa direto; vazio e texto inválido não quebram", () => {
    expect(localDay("2026-10-24")).toBe("2026-10-24");
    expect(localDay(null)).toBe("");
    expect(localDay(undefined)).toBe("");
    expect(localDay("2026-10-24 sem hora")).toBe("2026-10-24");
  });
});
