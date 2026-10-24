import { describe, expect, it } from "vitest";
import { formatMinutes, parseDuration, timeBankByEmployee, timeBankSummary, validateTimeEntry } from "./timebank";

describe("banco de horas (regras puras)", () => {
  it("formatMinutes: sinal, horas e minutos com dois dígitos", () => {
    expect(formatMinutes(150)).toBe("+2h30");
    expect(formatMinutes(-60)).toBe("−1h00");
    expect(formatMinutes(-5)).toBe("−0h05");
    expect(formatMinutes(0)).toBe("0h00");
    expect(formatMinutes(605, { signed: false })).toBe("10h05");
    expect(formatMinutes(-90, { signed: false })).toBe("1h30");
  });

  it("parseDuration aceita 2:30, 2h30, 2h, 45min, 1,5 e 1.5 (horas) e sinal negativo", () => {
    expect(parseDuration("2:30")).toBe(150);
    expect(parseDuration("2h30")).toBe(150);
    expect(parseDuration("2h")).toBe(120);
    expect(parseDuration("45min")).toBe(45);
    expect(parseDuration("45m")).toBe(45);
    expect(parseDuration("1,5")).toBe(90);
    expect(parseDuration("1.5")).toBe(90);
    expect(parseDuration("-1:15")).toBe(-75);
    expect(parseDuration("−2h")).toBe(-120);
    expect(parseDuration(" +0:30 ")).toBe(30);
  });

  it("parseDuration recusa texto sem duração ou com minutos inválidos", () => {
    for (const bad of ["", "abc", "2:75", "1,5,5", "h", ":30", "2h99"]) expect(parseDuration(bad), bad).toBeNull();
  });

  it("timeBankSummary: saldo só com aprovadas; pendentes à parte; recusadas não contam", () => {
    const summary = timeBankSummary([
      { minutes: 120, status: "aprovada" },
      { minutes: -45, status: "aprovada" },
      { minutes: 60, status: "pendente" },
      { minutes: -30, status: "pendente" },
      { minutes: 500, status: "recusada" },
    ]);
    expect(summary).toEqual({ balance: 75, credits: 120, debits: -45, pending: 30, pendingCount: 2 });
  });

  it("timeBankByEmployee agrupa por colaborador", () => {
    const map = timeBankByEmployee([
      { employee_id: "a", minutes: 60, status: "aprovada" },
      { employee_id: "b", minutes: -30, status: "aprovada" },
      { employee_id: "a", minutes: 30, status: "pendente" },
    ]);
    expect(map.get("a")).toMatchObject({ balance: 60, pending: 30 });
    expect(map.get("b")).toMatchObject({ balance: -30, pending: 0 });
    expect(map.get("c")).toBeUndefined();
  });

  it("validateTimeEntry: data, duração diferente de zero até 24h, motivo e no máximo 1 ano para trás", () => {
    const today = "2026-10-24";
    expect(validateTimeEntry({ date: "2026-10-20", minutes: 90, reason: "Fechamento do mês" }, today)).toBeNull();
    expect(validateTimeEntry({ date: "2026-10-30", minutes: -120, reason: "Compensação combinada" }, today)).toBeNull();
    expect(validateTimeEntry({ date: "", minutes: 90, reason: "x" }, today)).toMatch(/data/i);
    expect(validateTimeEntry({ date: "2026-10-20", minutes: null, reason: "Motivo" }, today)).toMatch(/duração/i);
    expect(validateTimeEntry({ date: "2026-10-20", minutes: 0, reason: "Motivo" }, today)).toMatch(/duração/i);
    expect(validateTimeEntry({ date: "2026-10-20", minutes: 24 * 60 + 1, reason: "Motivo" }, today)).toMatch(/24/);
    expect(validateTimeEntry({ date: "2026-10-20", minutes: 60, reason: "  " }, today)).toMatch(/motivo/i);
    expect(validateTimeEntry({ date: "2026-10-25", minutes: 60, reason: "Hora extra" }, today)).toMatch(/futuro/i);
    expect(validateTimeEntry({ date: "2025-10-23", minutes: 60, reason: "Muito antiga" }, today)).toMatch(/1 ano/i);
  });
});
