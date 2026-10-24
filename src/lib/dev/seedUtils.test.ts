// Datas dos dados de exemplo: "hoje" é o dia do computador (como todayIso), não o dia UTC.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { todayIso } from "@/lib/utils";
import { day, ts } from "./seedUtils";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

beforeEach(() => {
  // 23h30 no horário local: em Brasília já é o dia seguinte em UTC.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 24, 23, 30));
});
afterEach(() => vi.useRealTimers());

describe("seedUtils", () => {
  it("day() conta dias a partir do dia local", () => {
    expect(day(0)).toBe("2026-10-24");
    expect(day(1)).toBe("2026-10-25");
    expect(day(-24)).toBe("2026-09-30");
    expect(day(0)).toBe(todayIso());
  });

  it("ts() é um instante ISO na hora local pedida, no dia local", () => {
    const value = ts(0, 9);
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const at = new Date(value);
    expect(at.getHours()).toBe(9);
    expect(todayIso(at)).toBe("2026-10-24");
    expect(todayIso(new Date(ts(-3)))).toBe("2026-10-21");
  });
});
