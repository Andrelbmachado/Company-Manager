import { describe, expect, it } from "vitest";
import { addDays, addMonths, daysBetween, localDayOf, monthLabel, monthOf, monthsBetween, periodPresets, sharePercent } from "./common";

describe("datas dos relatórios", () => {
  it("dia local de data de documento, instante ISO e datetime('now') do SQLite (UTC)", () => {
    expect(localDayOf("2026-10-24")).toBe("2026-10-24");
    expect(localDayOf(new Date(2026, 9, 24, 23, 30).toISOString())).toBe("2026-10-24");
    const sqliteUtc = "2026-10-24 12:00:00";
    const expected = new Date(Date.UTC(2026, 9, 24, 12));
    expect(localDayOf(sqliteUtc)).toBe(`${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, "0")}-${String(expected.getDate()).padStart(2, "0")}`);
    expect(localDayOf(null)).toBeNull();
    expect(localDayOf("")).toBeNull();
    expect(localDayOf("lixo")).toBeNull();
  });

  it("soma dias e meses sem depender de fuso nem de horário de verão", () => {
    expect(addDays("2026-10-24", 10)).toBe("2026-11-03");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(daysBetween("2026-10-01", "2026-10-24")).toBe(23);
    expect(daysBetween("2026-10-24", "2026-10-01")).toBe(-23);
    expect(monthOf("2026-10-24")).toBe("2026-10");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(monthsBetween("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(monthsBetween("2026-02", "2025-11")).toEqual([]);
    expect(monthLabel("2026-10")).toBe("out/2026");
    expect(monthLabel("2026-01")).toBe("jan/2026");
  });

  it("atalhos de período a partir de hoje", () => {
    const presets = periodPresets("2026-10-24");
    expect(presets.find((preset) => preset.key === "este_mes")).toMatchObject({ from: "2026-10-01", to: "2026-10-24" });
    expect(presets.find((preset) => preset.key === "mes_passado")).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
    expect(presets.find((preset) => preset.key === "ultimos_90")).toMatchObject({ from: "2026-07-27", to: "2026-10-24" });
    expect(presets.find((preset) => preset.key === "este_ano")).toMatchObject({ from: "2026-01-01", to: "2026-10-24" });
  });

  it("percentual com uma casa e sem dividir por zero", () => {
    expect(sharePercent(1, 3)).toBe(33.3);
    expect(sharePercent(5, 0)).toBe(0);
  });
});
