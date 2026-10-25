import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@/types";
import { describeWhen, eventInput, normalizeTime, sortEventRows, toEventRow, type EventRow } from "./eventRows";

const event = (values: Partial<CalendarEvent>): CalendarEvent =>
  ({ id: "ev", company_id: "c", source_id: null, uid: null, title: "Reunião", starts_at: "2026-10-22T13:00:00.000Z", ends_at: "2026-10-22T14:30:00.000Z", all_day: 0, location: null, description: null, user_id: null, kind: "reuniao", ...values }) as CalendarEvent;

describe("linhas da tabela Eventos do app", () => {
  it("aceita as horas do jeito que se digita e recusa hora impossível", () => {
    expect(["9", "09:30", "9h30", "15h", "0930", " 7:05 "].map(normalizeTime)).toEqual(["09:00", "09:30", "09:30", "15:00", "09:30", "07:05"]);
    for (const text of ["25:99", "12:60", "meio-dia", ""]) expect(() => normalizeTime(text)).toThrow(/Hora inválida/);
  });

  it("evento com horário vira dia e hora de São Paulo e volta igual", () => {
    const row = toEventRow(event({}));
    expect(row).toMatchObject({ all_day: 0, start_day: "2026-10-22", start_time: "10:00", end_day: "2026-10-22", end_time: "11:30", person: "empresa" });
    expect(eventInput(row)).toMatchObject({ starts_at: "2026-10-22T10:00", ends_at: "2026-10-22T11:30", all_day: 0 });
  });

  it("dia inteiro mostra o fim inclusivo e grava o fim exclusivo", () => {
    const row = toEventRow(event({ all_day: 1, starts_at: "2026-10-30", ends_at: "2026-11-02", user_id: "u1" }));
    expect(row).toMatchObject({ start_day: "2026-10-30", end_day: "2026-11-01", start_time: null, person: "u1" });
    expect(eventInput(row)).toMatchObject({ starts_at: "2026-10-30", ends_at: "2026-11-02", all_day: 1 });
    expect(() => eventInput({ ...row, end_day: "2026-10-29" })).toThrow(/depois do início/);
    expect(() => eventInput({ ...row, all_day: 0, start_time: null })).toThrow(/hora de início/);
  });

  it("descreve quando acontece e ordena próximos antes dos passados", () => {
    expect(describeWhen("2026-10-22T13:00:00.000Z", "2026-10-22T14:30:00.000Z", false)).toBe("22/10/2026, 10:00–11:30");
    expect(describeWhen("2026-10-30", "2026-11-02", true)).toBe("30/10/2026 a 01/11/2026");
    expect(describeWhen("2026-10-30", undefined, true)).toBe("30/10/2026 (dia inteiro)");
    const row = (id: string, start_day: string): EventRow => ({ id, title: id, kind: "evento", all_day: 1, start_day, start_time: null, end_day: start_day, end_time: null, person: "empresa", location: null });
    expect(sortEventRows([row("passado-antigo", "2026-01-01"), row("depois", "2026-11-10"), row("passado", "2026-10-01"), row("hoje", "2026-10-20")], "2026-10-20").map((item) => item.id)).toEqual([
      "hoje",
      "depois",
      "passado",
      "passado-antigo",
    ]);
  });
});
