// Leitura de agendas iCal (Google, Apple/iCloud, Outlook): recorrências expandidas no período, fuso de cada evento
// (com ou sem VTIMEZONE, nomes do Windows, horário flutuante = São Paulo) e erros legíveis.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { zonedParts } from "@/components/shared/calendar/layout";
import { IcsError, parseIcs } from "./ical";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const OUTUBRO = { start: "2026-10-01", end: "2026-11-01" };
const OUT_NOV = { start: "2026-10-01", end: "2026-12-01" };

describe("parseIcs", () => {
  it("evento semanal com RRULE gera 4 ocorrências no mês, às 09:00 de São Paulo, com chave UID + início", () => {
    const items = parseIcs(fixture("google-semanal.ics"), OUTUBRO);
    const weekly = items.filter((item) => item.title === "Reunião semanal");
    expect(weekly.map((item) => item.start)).toEqual([
      "2026-10-06T12:00:00.000Z",
      "2026-10-13T12:00:00.000Z",
      "2026-10-20T12:00:00.000Z",
      "2026-10-27T12:00:00.000Z",
    ]);
    expect(weekly.every((item) => zonedParts(new Date(item.start)).minute === 9 * 60)).toBe(true);
    expect(weekly[0]).toMatchObject({ end: "2026-10-06T13:00:00.000Z", allDay: false, location: "Sala 1", description: "Pauta da semana, metas" });
    expect(weekly[0].uid).toBe("semanal-123@google.com::2026-10-06T12:00:00.000Z");
    expect(new Set(weekly.map((item) => item.uid)).size).toBe(4);
    expect(weekly.every((item) => item.id === item.uid)).toBe(true);
  });

  it("dia inteiro fica 'YYYY-MM-DD' com fim exclusivo; evento em UTC mantém o instante; fora do período não entra", () => {
    const items = parseIcs(fixture("google-semanal.ics"), OUTUBRO);
    expect(items.find((item) => item.title === "Feriado")).toMatchObject({ uid: "feriado-1@google.com", start: "2026-10-12", end: "2026-10-13", allDay: true });
    expect(items.find((item) => item.title === "Call com cliente")).toMatchObject({ start: "2026-10-15T17:00:00.000Z", end: "2026-10-15T18:00:00.000Z" });
    expect(items.some((item) => item.title === "Evento antigo")).toBe(false);
    expect(parseIcs(fixture("google-semanal.ics"), { start: "2026-11-01", end: "2026-12-01" }).filter((item) => item.title === "Reunião semanal")).toHaveLength(4);
  });

  it("TZID sem VTIMEZONE, nome de fuso do Windows (Outlook), TZID antigo do Thunderbird e horário flutuante", () => {
    const items = parseIcs(fixture("fusos.ics"), OUTUBRO);
    const byTitle = (title: string) => items.find((item) => item.title === title);
    expect(byTitle("Sem VTIMEZONE")).toMatchObject({ start: "2026-10-20T12:00:00.000Z", end: "2026-10-20T12:30:00.000Z" });
    // Sem fuso nenhum (flutuante): horário de São Paulo, o fuso do app.
    expect(byTitle("Horário flutuante")).toMatchObject({ start: "2026-10-21T11:30:00.000Z" });
    expect(byTitle("Outlook")).toMatchObject({ start: "2026-10-22T12:00:00.000Z", end: "2026-10-22T13:00:00.000Z" });
    expect(byTitle("Thunderbird antigo")).toMatchObject({ start: "2026-10-23T12:00:00.000Z", end: "2026-10-23T12:45:00.000Z" });
  });

  it("recorrência diária atravessando o fim do horário de verão (Nova York) mantém 09:00 local; EXDATE, exceção movida e cancelada", () => {
    const items = parseIcs(fixture("recorrencias.ics"), OUT_NOV);
    const standup = items.filter((item) => item.title.startsWith("Standup"));
    expect(standup.map((item) => item.start)).toEqual([
      "2026-10-26T13:00:00.000Z",
      "2026-10-27T13:00:00.000Z",
      // 28: EXDATE. 29: movido para as 15:00. 30: cancelado.
      "2026-10-29T19:00:00.000Z",
      "2026-10-31T13:00:00.000Z",
      // 1º/11: fim do horário de verão nos EUA; continua 09:00 em Nova York.
      "2026-11-01T14:00:00.000Z",
      "2026-11-02T14:00:00.000Z",
      "2026-11-03T14:00:00.000Z",
      "2026-11-04T14:00:00.000Z",
    ]);
    const moved = standup[2];
    expect(moved.title).toBe("Standup (tarde)");
    // A chave usa o início original da ocorrência (RECURRENCE-ID): mover o evento na fonte não cria outro.
    expect(moved.uid).toBe("standup@exemplo::2026-10-29T13:00:00.000Z");
  });

  it("mensal na última sexta (dia inteiro), evento cancelado some e evento sem UID ganha chave estável", () => {
    const items = parseIcs(fixture("recorrencias.ics"), OUT_NOV);
    expect(items.filter((item) => item.title === "Fechamento do mês").map((item) => [item.start, item.end])).toEqual([
      ["2026-10-30", "2026-10-31"],
      ["2026-11-27", "2026-11-28"],
    ]);
    expect(items.some((item) => item.title === "Cancelado")).toBe(false);
    const semUid = items.filter((item) => item.title === "Sem UID");
    expect(semUid).toHaveLength(1);
    expect(semUid[0].uid).toBeTruthy();
    expect(semUid[0].end).toBeUndefined();
    expect(parseIcs(fixture("recorrencias.ics"), OUT_NOV).find((item) => item.title === "Sem UID")?.uid).toBe(semUid[0].uid);
  });

  it("aceita CRLF, linhas dobradas e chaves repetidas (a segunda ganha sufixo)", () => {
    const text = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:repetido",
      "DTSTART:20261010T120000Z",
      "SUMMARY:Um título bem comprido que o servidor dobrou em duas lin",
      " has como manda o RFC",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:repetido",
      "DTSTART:20261011T120000Z",
      "SUMMARY:Outro",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const items = parseIcs(text, OUTUBRO);
    expect(items.map((item) => item.title)).toEqual(["Um título bem comprido que o servidor dobrou em duas linhas como manda o RFC", "Outro"]);
    expect(items.map((item) => item.uid)).toEqual(["repetido", "repetido#2"]);
  });

  it("conteúdo que não é agenda dá erro legível", () => {
    expect(() => parseIcs("<!DOCTYPE html><html><body>Fazer login</body></html>", OUTUBRO)).toThrow(IcsError);
    expect(() => parseIcs("<!DOCTYPE html><html><body>Fazer login</body></html>", OUTUBRO)).toThrow(/página da web/);
    expect(() => parseIcs("isto não é uma agenda", OUTUBRO)).toThrow(/não é uma agenda iCal/);
    expect(() => parseIcs("BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:quebrado\nEND:VEVENT\nEND:VCALENDAR", OUTUBRO)).toThrow(IcsError);
  });
});
