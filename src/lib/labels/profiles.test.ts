// Perfil de área: rótulos de cards, gráficos e módulos conforme a área da empresa, com sobrescritas editáveis.
import { describe, expect, it } from "vitest";
import {
  AREA_PROFILES,
  AREA_PROFILE_LABELS,
  DEFAULT_AREA_PROFILE,
  LABEL_DEFS,
  LABEL_KEYS,
  defaultLabelFor,
  labelFor,
  parseAreaProfile,
  parseLabelOverrides,
} from "./profiles";

describe("labelFor", () => {
  it("exemplos fixos do plano: TI fala em projetos, advocacia em clientes (processos/casos em andamento)", () => {
    expect(labelFor("dashboard.active_work", "ti", {})).toBe("Projetos ativos");
    expect(labelFor("dashboard.active_work", "advocacia", {})).toBe("Clientes ativos");
  });

  it("a sobrescrita vence o perfil; sobrescrita vazia ou só espaços é ignorada", () => {
    expect(labelFor("dashboard.active_work", "advocacia", { "dashboard.active_work": "Casos em andamento" })).toBe("Casos em andamento");
    expect(labelFor("dashboard.active_work", "ti", { "dashboard.active_work": "  Contratos  " })).toBe("Contratos");
    expect(labelFor("dashboard.active_work", "ti", { "dashboard.active_work": "   " })).toBe("Projetos ativos");
  });

  it("chave desconhecida devolve a própria chave (nunca texto vazio)", () => {
    expect(labelFor("dashboard.nao_existe", "ti", {})).toBe("dashboard.nao_existe");
    expect(labelFor("dashboard.nao_existe", "ti", { "dashboard.nao_existe": "Algo" })).toBe("Algo");
  });

  it("perfil desconhecido usa o padrão; personalizado parte do texto padrão de cada chave", () => {
    expect(labelFor("dashboard.active_work", "xyz", {})).toBe(labelFor("dashboard.active_work", DEFAULT_AREA_PROFILE, {}));
    expect(labelFor("module.projects", "personalizado", {})).toBe(defaultLabelFor("module.projects"));
    expect(labelFor("module.projects", "advocacia", {})).not.toBe(defaultLabelFor("module.projects"));
  });

  it("todo rótulo de todo perfil é texto não vazio", () => {
    for (const profile of AREA_PROFILES) {
      expect(AREA_PROFILE_LABELS[profile]).toBeTruthy();
      for (const key of LABEL_KEYS) expect(labelFor(key, profile, {}).trim(), `${profile}/${key}`).not.toBe("");
    }
  });

  it("cobre o que a Fase B usa: os 4 cards e o gráfico do dashboard, Calendário e Fornecedores", () => {
    expect(LABEL_KEYS).toEqual(
      expect.arrayContaining([
        "dashboard.profit",
        "dashboard.debt",
        "dashboard.payables_week",
        "dashboard.receivables_week",
        "dashboard.active_work",
        "dashboard.balance_chart",
        "dashboard.balance_chart_month",
        "dashboard.balance_chart_week",
        "dashboard.balance_realized",
        "dashboard.balance_accumulated",
        "dashboard.balance_forecast",
        "module.dashboard",
        "module.calendar",
        "module.projects",
        "module.suppliers",
      ]),
    );
    expect(new Set(LABEL_KEYS).size).toBe(LABEL_KEYS.length);
    for (const def of LABEL_DEFS) expect(def.description.trim(), def.key).not.toBe("");
    expect(labelFor("dashboard.debt", "ti", {})).toBe("Dívida do mês");
    expect(labelFor("module.calendar", "ti", {})).toBe("Calendário");
    expect(labelFor("module.suppliers", "ti", {})).toBe("Fornecedores");
  });
});

describe("leitura do que está gravado em settings", () => {
  it("parseAreaProfile aceita só perfis conhecidos", () => {
    expect(parseAreaProfile("advocacia")).toBe("advocacia");
    expect(parseAreaProfile("ADVOCACIA")).toBe(DEFAULT_AREA_PROFILE);
    expect(parseAreaProfile(undefined)).toBe(DEFAULT_AREA_PROFILE);
    expect(parseAreaProfile({ profile: "ti" })).toBe(DEFAULT_AREA_PROFILE);
  });

  it("parseLabelOverrides guarda só chaves conhecidas com texto, sem espaços nas pontas e com limite de tamanho", () => {
    expect(
      parseLabelOverrides({
        "dashboard.active_work": "  Casos  ",
        "dashboard.profit": "",
        "dashboard.payables_week": 42,
        "chave.inventada": "X",
        "module.crm": "C".repeat(200),
      }),
    ).toEqual({ "dashboard.active_work": "Casos", "module.crm": "C".repeat(60) });
    expect(parseLabelOverrides(null)).toEqual({});
    expect(parseLabelOverrides(["dashboard.profit"])).toEqual({});
    expect(parseLabelOverrides("texto")).toEqual({});
  });
});
