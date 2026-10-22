import type { Opportunity } from "@/types";

export type Stage = Opportunity["stage"];

/** Estágios do funil de oportunidades, na ordem do pipeline. */
export const STAGES: readonly Stage[] = [
  "novo",
  "qualificacao",
  "proposta",
  "negociacao",
  "ganho",
  "perdido",
] as const;

/** Agrupa as oportunidades por estágio, garantindo uma entrada (possivelmente vazia) para cada estágio conhecido. */
export function groupByStage(opps: Opportunity[]): Record<Stage, Opportunity[]> {
  const grouped = Object.fromEntries(STAGES.map((s) => [s, [] as Opportunity[]])) as Record<
    Stage,
    Opportunity[]
  >;
  for (const opp of opps) {
    if (grouped[opp.stage]) grouped[opp.stage].push(opp);
  }
  return grouped;
}

/** Soma dos valores de uma lista de oportunidades. */
export function stageTotal(opps: Opportunity[]): number {
  return opps.reduce((sum, o) => sum + o.value, 0);
}

/**
 * Valor ponderado do pipeline = soma de (valor * probabilidade) das oportunidades
 * ainda em aberto (exclui "ganho" e "perdido"). Probabilidade é 0..100.
 */
export function weightedPipelineValue(opps: Opportunity[]): number {
  return opps
    .filter((o) => o.stage !== "ganho" && o.stage !== "perdido")
    .reduce((sum, o) => sum + (o.value * o.probability) / 100, 0);
}
