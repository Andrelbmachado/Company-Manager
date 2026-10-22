import { useMemo } from "react";
import { Gift } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { formatMoney } from "@/lib/prospecting/contact";
import { REFERRAL_RULES, referredDiscount, summarizeReferrals } from "@/lib/prospecting/referral";
import { LeadStatusBadge } from "./LeadsPanel";
import type { Lead } from "@/types";

const months = (n: number) => `${n} ${n === 1 ? "mês" : "meses"}`;

/** Quem indicou quantos, quantos fecharam e os bônus de nível atingidos. Só indicação fechada conta. */
export function ReferralPanel({ leads }: { leads: Lead[] }) {
  const referrers = useMemo(() => summarizeReferrals(leads), [leads]);
  const referred = useMemo(() => leads.filter((lead) => lead.referred_by?.trim()), [leads]);
  const tierText = REFERRAL_RULES.tiers.map((tier) => `${tier.closed} fechados: +${months(tier.extraMonths)}`).join("; ");

  return (
    <div className="space-y-6">
      <section className="rounded-xl border bg-card p-5">
        <h2 className="font-semibold">Como funciona</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Só vale quando o indicado fecha o negócio: contrato assinado e pago. Indicação que não fecha não conta nem gera benefício para ninguém.</li>
          <li>Por indicado que fechar, quem indicou ganha {months(REFERRAL_RULES.monthsPerClosed)} grátis na mensalidade e o indicado ganha {REFERRAL_RULES.referredSetupDiscount * 100}% de desconto no setup.</li>
          <li>Bônus de nível para quem indica: {tierText}{REFERRAL_RULES.cumulative ? " (os níveis se somam)" : " (não se somam: vale o maior nível atingido)"}.</li>
          <li>Vale para qualquer pacote: Básico, Essencial ou Premium.</li>
        </ul>
      </section>

      {referrers.length === 0 ? (
        <EmptyState icon={Gift} title="Nenhuma indicação registrada" description="Abra um lead e preencha o campo “Indicado por” para começar a contar." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr>
                  {["Quem indicou", "Indicações", "Fechadas", "Pendentes", "Meses grátis (base)", "Bônus de nível", "Total de meses grátis", "Próximo nível"].map((heading) => (
                    <th key={heading} className="whitespace-nowrap px-3 py-3 text-left font-medium text-muted-foreground">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {referrers.map((row) => (
                  <tr key={row.referrer}>
                    <td className="px-3 py-2.5 font-medium">{row.referrer}</td>
                    <td className="px-3 py-2.5">{row.total}</td>
                    <td className="px-3 py-2.5 font-semibold">{row.closed}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{row.pending}</td>
                    <td className="px-3 py-2.5">{months(row.baseMonths)}</td>
                    <td className="px-3 py-2.5">
                      {row.tiersReached.length === 0 ? <span className="text-muted-foreground">Nenhum</span> : row.tiersReached.map((tier) => `Nível ${tier.closed} (+${months(tier.extraMonths)})`).join(", ")}
                    </td>
                    <td className="px-3 py-2.5 font-semibold">{months(row.totalFreeMonths)}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{row.toNextTier === null ? "Nível máximo" : `Faltam ${row.toNextTier}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr>
                  {["Indicado", "Indicado por", "Status do lead", "Benefício", "Desconto no setup (10%)"].map((heading) => (
                    <th key={heading} className="whitespace-nowrap px-3 py-3 text-left font-medium text-muted-foreground">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {referred.map((lead) => (
                  <tr key={lead.id}>
                    <td className="px-3 py-2.5 font-medium">{lead.name}</td>
                    <td className="px-3 py-2.5">{lead.referred_by}</td>
                    <td className="px-3 py-2.5"><LeadStatusBadge status={lead.status} /></td>
                    <td className="px-3 py-2.5">{lead.referral_status === "concedido" ? "Concedido" : "Pendente até o fechamento"}</td>
                    <td className="px-3 py-2.5">{lead.referral_status === "concedido" ? formatMoney(referredDiscount(lead.estimated_setup)) : <span className="text-muted-foreground">{formatMoney(referredDiscount(lead.estimated_setup))} se fechar</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
