import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FilePlus2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { StatCard } from "@/components/shared/StatCard";
import { displayProposalStatus } from "@/lib/crm/proposals";
import { fold } from "@/lib/crm/queries";
import { formatSequence } from "@/lib/db/sequence";
import { formatCurrency, todayIso } from "@/lib/utils";
import type { ProposalStatus } from "@/types";
import { ProposalsTable } from "../components/ProposalsTable";
import { BTN_SECONDARY, SELECT } from "../components/ui";
import { useCrmSession, useCustomerMap, useProposals } from "../components/useCrm";

const STATUSES: { value: ProposalStatus; label: string }[] = [
  { value: "rascunho", label: "Rascunho" },
  { value: "enviada", label: "Enviada" },
  { value: "aceita", label: "Aceita" },
  { value: "recusada", label: "Recusada" },
  { value: "expirada", label: "Expirada" },
];

/**
 * Propostas comerciais numa tabela editável (rascunho muda no lugar; Adicionar cria o rascunho), com situação (expirada =
 * enviada com validade vencida), totais e atalho para o editor com itens do catálogo.
 */
export default function ProposalsPage() {
  const { can } = useCrmSession();
  const { data: proposals = [], isLoading } = useProposals();
  const { map: customers } = useCustomerMap();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const today = todayIso();

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
        actions={can("create", "proposals") ? <Link to="/crm/propostas/nova" className={BTN_SECONDARY}><FilePlus2 size={14} /> Proposta com itens do catálogo</Link> : undefined}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Aguardando resposta" value={formatCurrency(sum(sent))} />
        <StatCard title="Aceitas" value={formatCurrency(sum(accepted))} />
        <StatCard title="Taxa de aceite" value={decided ? `${Math.round((accepted.length / decided) * 100)}%` : "—"} />
        <StatCard title="Rascunhos" value={rows.filter((row) => row.status === "rascunho").length} />
      </div>

      <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar por número, título, cliente...">
        <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filtrar por situação" className={SELECT}>
          <option value="">Todas as situações</option>
          {STATUSES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </PageToolbar>

      <ProposalsTable proposals={filtered.map((row) => row.proposal)} loading={isLoading} emptyMessage={proposals.length ? "Nenhuma proposta com esses filtros: ajuste a busca." : undefined} />
    </div>
  );
}
