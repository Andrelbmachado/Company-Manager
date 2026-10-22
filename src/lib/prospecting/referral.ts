// Programa de indicação. Regra do André (INSTRUCAO_INDICACAO.md, versão escalonada; níveis NÃO se somam):
// tudo só vale quando o indicado FECHA (contrato assinado e pago). Indicação que não fecha não conta para ninguém.
//  - por indicado que fechar: quem indicou ganha 1 mês grátis na mensalidade e o indicado ganha 10% de desconto no setup;
//  - bônus de nível (só o maior atingido): 3 fechados = +1 mês extra; 5 fechados = +2 meses extras.
// Vale para qualquer pacote (Básico, Essencial ou Premium).
import type { Lead, ReferralStatus } from "@/types";

export const REFERRAL_RULES = {
  /** Meses grátis para quem indica, por indicado fechado. */
  monthsPerClosed: 1,
  /** Desconto no setup do indicado (10%). */
  referredSetupDiscount: 0.1,
  /** Os bônus de nível NÃO se somam (decisão do André): vale só o maior nível atingido. Com 5 fechados: 5 meses + 2 extras = 7. */
  cumulative: false,
  tiers: [
    { closed: 3, extraMonths: 1 },
    { closed: 5, extraMonths: 2 },
  ],
} as const;

export type ReferralLead = Pick<Lead, "id" | "name" | "status" | "referred_by" | "referral_status" | "estimated_setup">;

export interface ReferrerSummary {
  referrer: string;
  /** Todas as indicações registradas. */
  total: number;
  /** Indicações que fecharam (benefício concedido). */
  closed: number;
  /** Aguardando o fechamento: ainda não valem nada. */
  pending: number;
  baseMonths: number;
  tiersReached: { closed: number; extraMonths: number }[];
  bonusMonths: number;
  totalFreeMonths: number;
  /** Quantos fechamentos faltam para o próximo nível (null = nível máximo atingido). */
  toNextTier: number | null;
}

const normalize = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

/** Status do benefício derivado do status do lead: só "concedido" quando o indicado fecha. */
export function referralStatusFor(leadStatus: string, referredBy: string | null | undefined): ReferralStatus | null {
  if (!referredBy?.trim()) return null;
  return leadStatus === "fechado" ? "concedido" : "pendente";
}

/** Desconto de 10% no setup do indicado (valor cheio; só é concedido no fechamento). */
export function referredDiscount(setup: number): number {
  return Math.round(setup * REFERRAL_RULES.referredSetupDiscount * 100) / 100;
}

/** Nível que vale para quem tem `closed` indicados fechados. Sem soma: só o maior nível atingido (`REFERRAL_RULES.cumulative`). */
export function bonusFor(closed: number): { tiersReached: { closed: number; extraMonths: number }[]; bonusMonths: number } {
  const reached = REFERRAL_RULES.tiers.filter((tier) => closed >= tier.closed);
  const counted = REFERRAL_RULES.cumulative ? reached : reached.slice(-1);
  return { tiersReached: counted.map((tier) => ({ ...tier })), bonusMonths: counted.reduce((sum, tier) => sum + tier.extraMonths, 0) };
}

/** Contagem de indicações fechadas por indicador (agrupado pelo nome, sem diferenciar maiúsculas/espaços). */
export function summarizeReferrals(leads: ReferralLead[]): ReferrerSummary[] {
  const groups = new Map<string, { name: string; leads: ReferralLead[] }>();
  for (const lead of leads) {
    const name = lead.referred_by?.trim();
    if (!name) continue;
    const key = normalize(name);
    const group = groups.get(key) ?? { name, leads: [] };
    group.leads.push(lead);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map<ReferrerSummary>(({ name, leads: referred }) => {
      const closed = referred.filter((lead) => lead.status === "fechado").length;
      const { tiersReached, bonusMonths } = bonusFor(closed);
      const next = REFERRAL_RULES.tiers.find((tier) => closed < tier.closed);
      const baseMonths = closed * REFERRAL_RULES.monthsPerClosed;
      return {
        referrer: name,
        total: referred.length,
        closed,
        pending: referred.length - closed,
        baseMonths,
        tiersReached,
        bonusMonths,
        totalFreeMonths: baseMonths + bonusMonths,
        toNextTier: next ? next.closed - closed : null,
      };
    })
    .sort((a, b) => b.closed - a.closed || b.total - a.total || a.referrer.localeCompare(b.referrer, "pt-BR"));
}
