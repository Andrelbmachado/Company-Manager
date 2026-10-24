import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FilePlus2, FileSignature } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { displayProposalStatus } from "@/lib/crm/proposals";
import { fold } from "@/lib/crm/queries";
import { formatSequence } from "@/lib/db/sequence";
import { cn, formatCurrency, formatDay, todayIso } from "@/lib/utils";
import type { ProposalStatus } from "@/types";
import { BTN_PRIMARY, CARD, LINK, SELECT, TD, TH } from "../components/ui";
import { useCrmSession, useCustomerMap, useOpportunities, useProposals } from "../components/useCrm";

const STATUSES: { value: ProposalStatus; label: string }[] = [
  { value: "rascunho", label: "Rascunho" },
  { value: "enviada", label: "Enviada" },
  { value: "aceita", label: "Aceita" },
  { value: "recusada", label: "Recusada" },
  { value: "expirada", label: "Expirada" },
];

/** Propostas comerciais: lista com situação (expirada = enviada com validade vencida), totais e atalho para o editor. */
export default function ProposalsPage() {
  const { can } = useCrmSession();
  const navigate = useNavigate();
  const { data: proposals = [], isLoading } = useProposals();
  const { map: customers } = useCustomerMap();
  const { data: opportunities = [] } = useOpportunities(can("view", "opportunities"));
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const today = todayIso();
  const opportunityTitles = useMemo(() => new Map(opportunities.map((opp) => [opp.id, opp.title])), [opportunities]);

  const rows = useMemo(
    () =>
      proposals.map((proposal) => ({
        proposal,
        status: displayProposalStatus(proposal, today),
        number: formatSequence("proposals", proposal.number),
        customer: proposal.customer_id ? customers.get(proposal.customer_id)?.name ?? null : null,
      })),
    [proposals, customers, today],
  );
  const filtered = rows.filter((row) => {
    if (status && row.status !== status) return false;
    const term = fold(search.trim());
    return !term || [row.number, row.proposal.title, row.customer].some((field) => fold(field).includes(term));
  });
  const sum = (list: typeof rows) => list.reduce((total, row) => total + Number(row.proposal.value ?? 0), 0);
  const sent = rows.filter((row) => row.status === "enviada");
  const accepted = rows.filter((row) => row.status === "aceita");
  const decided = rows.filter((row) => row.status === "aceita" || row.status === "recusada").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Propostas"
        description="Propostas comerciais com itens do catálogo, condições e PDF"
        actions={can("create", "proposals") ? <Link to="/crm/propostas/nova" className={BTN_PRIMARY}><FilePlus2 size={14} /> Nova proposta</Link> : undefined}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Aguardando resposta" value={formatCurrency(sum(sent))} kind="text" hint={`${sent.length} enviada(s) no prazo`} />
        <StatCard title="Aceitas" value={formatCurrency(sum(accepted))} kind="text" hint={`${accepted.length} proposta(s)`} />
        <StatCard title="Taxa de aceite" value={decided ? `${Math.round((accepted.length / decided) * 100)}%` : "—"} hint="aceitas ÷ (aceitas + recusadas)" />
        <StatCard title="Rascunhos" value={rows.filter((row) => row.status === "rascunho").length} hint={`${rows.filter((row) => row.status === "expirada").length} expirada(s)`} />
      </div>

      <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar por número, título, cliente...">
        <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filtrar por situação" className={SELECT}>
          <option value="">Todas as situações</option>
          {STATUSES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </PageToolbar>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-12 animate-pulse rounded-lg bg-muted/30" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={FileSignature} title={proposals.length ? "Nenhuma proposta com esses filtros" : "Nenhuma proposta"} description={proposals.length ? "Ajuste a busca." : "Monte a primeira proposta com itens do catálogo."} />
      ) : (
        <div className={cn(CARD, "overflow-x-auto")}>
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className={TH}>Número</th>
                <th className={TH}>Título</th>
                <th className={TH}>Cliente</th>
                <th className={TH}>Oportunidade</th>
                <th className={TH}>Situação</th>
                <th className={cn(TH, "text-right")}>Total</th>
                <th className={TH}>Validade</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(({ proposal, status: shown, number, customer }) => (
                <tr key={proposal.id} onClick={() => navigate(`/crm/propostas/${proposal.id}`)} className="cursor-pointer hover:bg-muted/20">
                  <td className={cn(TD, "whitespace-nowrap")}>
                    <Link to={`/crm/propostas/${proposal.id}`} onClick={(event) => event.stopPropagation()} className={LINK}>{number}</Link>
                    {Number(proposal.version ?? 1) > 1 && <span className="ml-1 text-xs text-muted-foreground">v{proposal.version}</span>}
                  </td>
                  <td className={TD}>{proposal.title ?? "—"}</td>
                  <td className={TD}>{customer && proposal.customer_id ? <Link to={`/crm/clientes/${proposal.customer_id}`} onClick={(event) => event.stopPropagation()} className={LINK}>{customer}</Link> : <span className="text-muted-foreground">—</span>}</td>
                  <td className={cn(TD, "text-muted-foreground")}>
                    {proposal.opportunity_id && opportunityTitles.get(proposal.opportunity_id) ? (
                      <Link to={`/crm/funil?oportunidade=${proposal.opportunity_id}`} onClick={(event) => event.stopPropagation()} className={LINK}>{opportunityTitles.get(proposal.opportunity_id)}</Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={TD}><StatusBadge status={shown} /></td>
                  <td className={cn(TD, "text-right tabular-nums")}>{formatCurrency(Number(proposal.value ?? 0))}</td>
                  <td className={cn(TD, "whitespace-nowrap", shown === "expirada" ? "font-semibold text-destructive" : "text-muted-foreground")}>{formatDay(proposal.valid_until)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
