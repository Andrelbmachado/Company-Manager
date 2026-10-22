import { describe, it, expect } from "vitest";
import { STAGES, groupByStage, stageTotal, weightedPipelineValue } from "./pipeline";
import type { Opportunity } from "@/types";

function opp(
  stage: Opportunity["stage"],
  value: number,
  probability = 50
): Opportunity {
  return {
    id: `o-${stage}-${value}`,
    company_id: "c1",
    title: `Op ${value}`,
    value,
    stage,
    probability,
    status: "open",
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  };
}

describe("groupByStage", () => {
  it("cria uma entrada para todos os estágios, mesmo vazios", () => {
    const grouped = groupByStage([opp("novo", 100)]);
    expect(Object.keys(grouped).sort()).toEqual([...STAGES].sort());
    expect(grouped.novo).toHaveLength(1);
    expect(grouped.ganho).toHaveLength(0);
  });

  it("agrupa cada oportunidade no estágio correto", () => {
    const grouped = groupByStage([
      opp("novo", 1),
      opp("novo", 2),
      opp("proposta", 3),
    ]);
    expect(grouped.novo).toHaveLength(2);
    expect(grouped.proposta).toHaveLength(1);
    expect(grouped.negociacao).toHaveLength(0);
  });

  it("lista vazia produz todos os estágios vazios", () => {
    const grouped = groupByStage([]);
    for (const s of STAGES) expect(grouped[s]).toEqual([]);
  });
});

describe("stageTotal", () => {
  it("soma os valores das oportunidades", () => {
    expect(stageTotal([opp("novo", 100), opp("novo", 250)])).toBe(350);
  });

  it("retorna 0 para lista vazia", () => {
    expect(stageTotal([])).toBe(0);
  });
});

describe("weightedPipelineValue", () => {
  it("pondera valor pela probabilidade e ignora ganho/perdido", () => {
    const opps = [
      opp("novo", 1000, 20), // 200
      opp("proposta", 2000, 50), // 1000
      opp("ganho", 5000, 100), // ignorado
      opp("perdido", 3000, 0), // ignorado
    ];
    expect(weightedPipelineValue(opps)).toBe(1200);
  });

  it("retorna 0 quando só há oportunidades fechadas", () => {
    expect(weightedPipelineValue([opp("ganho", 5000, 100), opp("perdido", 1000, 10)])).toBe(0);
  });

  it("retorna 0 para lista vazia", () => {
    expect(weightedPipelineValue([])).toBe(0);
  });
});
