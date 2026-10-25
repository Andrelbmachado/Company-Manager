import { useMemo } from "react";
import { Gift } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { statusLabel } from "@/components/shared/StatusBadge";
import { NoFilterMatchRow, SortableHeader, TableFilterBar, TableFilterToolbar, useSortFilter, type SortFilterColumn } from "@/components/shared/table";
import { formatMoney } from "@/lib/prospecting/contact";
import { REFERRAL_RULES, referredDiscount, summarizeReferrals, type ReferrerSummary } from "@/lib/prospecting/referral";
import { LeadStatusBadge } from "./LeadsPanel";
import type { Lead } from "@/types";

const months = (n: number) => `${n} ${n === 1 ? "mês" : "meses"}`;
const TH = "px-3 py-3 text-sm";
const tiersText = (row: ReferrerSummary) => (row.tiersReached.length === 0 ? "Nenhum" : row.tiersReached.map((tier) => `Nível ${tier.closed} (+${months(tier.extraMonths)})`).join(", "));
const benefit = (lead: Lead) => (lead.referral_status === "concedido" ? "Concedido" : "Pendente até o fechamento");

const REFERRER_COLUMNS: SortFilterColumn<ReferrerSummary>[] = [
  { key: "referrer", header: "Quem indicou", kind: "text" },
  { key: "total", header: "Indicações", kind: "integer" },
  { key: "closed", header: "Fechadas", kind: "integer" },
  { key: "pending", header: "Pendentes", kind: "integer" },
  { key: "baseMonths", header: "Meses grátis (base)", kind: "integer" },
  { key: "tiers", header: "Bônus de nível", kind: "text", sortValue: tiersText },
  { key: "totalFreeMonths", header: "Total de meses grátis", kind: "integer" },
  { key: "toNextTier", header: "Próximo nível", kind: "integer" },
];

const REFERRED_COLUMNS: SortFilterColumn<Lead>[] = [
  { key: "name", header: "Indicado", kind: "text" },
  { key: "referred_by", header: "Indicado por", kind: "text" },
  { key: "status", header: "Status do lead", kind: "select", sortValue: (lead) => statusLabel(lead.status) },
  { key: "referral_status", header: "Benefício", kind: "select", sortValue: benefit },
  { key: "discount", header: "Desconto no setup (10%)", kind: "money", sortValue: (lead) => referredDiscount(lead.estimated_setup) },
];

/** Quem indicou quantos, quantos fecharam e os bônus de nível atingidos. Só indicação fechada conta. */
export function ReferralPanel({ leads }: { leads: Lead[] }) {
  const referrers = useMemo(() => summarizeReferrals(leads), [leads]);
  const referred = useMemo(() => leads.filter((lead) => lead.referred_by?.trim()), [leads]);
  const tierText = REFERRAL_RULES.tiers.map((tier) => `${tier.closed} fechados: +${months(tier.extraMonths)}`).join("; ");
  const referrersView = useSortFilter(referrers, REFERRER_COLUMNS);
  const referredView = useSortFilter(referred, REFERRED_COLUMNS);

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
          <div className="rounded-xl border">
            <TableFilterToolbar view={referrersView} />
            <TableFilterBar view={referrersView} />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr>
                    {REFERRER_COLUMNS.map((column) => (
                      <SortableHeader key={column.key} label={column.header} sortKey={column.key} sort={referrersView.sort} onSort={referrersView.toggleSort} className={TH} />
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {referrersView.rows.map((row) => (
                    <tr key={row.referrer}>
                      <td className="px-3 py-2.5 font-medium">{row.referrer}</td>
                      <td className="px-3 py-2.5">{row.total}</td>
                      <td className="px-3 py-2.5 font-semibold">{row.closed}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{row.pending}</td>
                      <td className="px-3 py-2.5">{months(row.baseMonths)}</td>
                      <td className="px-3 py-2.5">
                        {row.tiersReached.length === 0 ? <span className="text-muted-foreground">Nenhum</span> : tiersText(row)}
                      </td>
                      <td className="px-3 py-2.5 font-semibold">{months(row.totalFreeMonths)}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{row.toNextTier === null ? "Nível máximo" : `Faltam ${row.toNextTier}`}</td>
                    </tr>
                  ))}
                  {!referrersView.rows.length && <NoFilterMatchRow colSpan={REFERRER_COLUMNS.length} />}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border">
            <TableFilterToolbar view={referredView} />
            <TableFilterBar view={referredView} />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr>
                    {REFERRED_COLUMNS.map((column) => (
                      <SortableHeader key={column.key} label={column.header} sortKey={column.key} sort={referredView.sort} onSort={referredView.toggleSort} className={TH} />
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {referredView.rows.map((lead) => (
                    <tr key={lead.id}>
                      <td className="px-3 py-2.5 font-medium">{lead.name}</td>
                      <td className="px-3 py-2.5">{lead.referred_by}</td>
                      <td className="px-3 py-2.5"><LeadStatusBadge status={lead.status} /></td>
                      <td className="px-3 py-2.5">{benefit(lead)}</td>
                      <td className="px-3 py-2.5">{lead.referral_status === "concedido" ? formatMoney(referredDiscount(lead.estimated_setup)) : <span className="text-muted-foreground">{formatMoney(referredDiscount(lead.estimated_setup))} se fechar</span>}</td>
                    </tr>
                  ))}
                  {!referredView.rows.length && <NoFilterMatchRow colSpan={REFERRED_COLUMNS.length} />}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
