// Propostas numa tabela editável (lista e aba da ficha do cliente). No rascunho, Editar muda título, cliente,
// oportunidade, validade e condições; o total vem dos itens (editor da proposta). Adicionar cria um rascunho com um item
// avulso (título × 1 × valor) para detalhar depois no editor.
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { StatusBadge, statusLabel } from "@/components/shared/StatusBadge";
import { saveProposalRows } from "@/lib/commercial/crmEdits";
import { getDb } from "@/lib/db/client";
import { displayProposalStatus } from "@/lib/crm/proposals";
import { formatSequence } from "@/lib/db/sequence";
import { cn, formatCurrency, formatDay, todayIso } from "@/lib/utils";
import { ROW_ACTION, refreshQueries, useEditActor } from "@/modules/catalog/components/inline";
import type { Proposal } from "@/types";
import { LINK } from "./ui";
import { useAudit, useCrmSession, useCustomerMap, useInvalidateCrm, useOpportunities } from "./useCrm";

interface ProposalsTableProps {
  proposals: Proposal[];
  loading?: boolean;
  /** Cliente fixo (ficha): sem a coluna Cliente e as linhas novas já vêm ligadas a ele. */
  customerId?: string;
  title?: string;
  emptyMessage?: string;
}

export function ProposalsTable({ proposals, loading, customerId, title = "Propostas", emptyMessage }: ProposalsTableProps) {
  const { companyId, can } = useCrmSession();
  const actor = useEditActor();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const invalidate = useInvalidateCrm();
  const audit = useAudit();
  const { data: customerList = [], map: customers } = useCustomerMap();
  const { data: opportunities = [] } = useOpportunities(can("view", "opportunities"));
  const opportunityTitles = new Map(opportunities.map((opp) => [opp.id, opp.title]));
  const today = todayIso();

  const customerColumn: EditableColumn<Proposal> = {
    key: "customer_id",
    header: "Cliente",
    kind: "select",
    width: 200,
    options: customerList.map((customer) => ({ value: customer.id, label: customer.name })),
    render: (proposal) => {
      const customer = proposal.customer_id ? customers.get(proposal.customer_id) : null;
      return customer ? <Link to={`/crm/clientes/${customer.id}`} className={LINK}>{customer.name}</Link> : <span className="text-muted-foreground">—</span>;
    },
  };
  const columns: EditableColumn<Proposal>[] = [
    {
      key: "number",
      header: "Número",
      kind: "number",
      readOnly: true,
      render: (proposal) => (
        <span className="whitespace-nowrap">
          <Link to={`/crm/propostas/${proposal.id}`} className={LINK}>{formatSequence("proposals", proposal.number)}</Link>
          {Number(proposal.version ?? 1) > 1 && <span className="ml-1 text-xs text-muted-foreground">v{proposal.version}</span>}
        </span>
      ),
    },
    { key: "title", header: "Título", kind: "text", required: true, width: 220 },
    ...(customerId ? [] : [customerColumn]),
    {
      key: "opportunity_id",
      header: "Oportunidade",
      kind: "select",
      width: 200,
      options: opportunities.filter((opp) => !customerId || opp.customer_id === customerId).map((opp) => ({ value: opp.id, label: opp.title })),
      render: (proposal) =>
        proposal.opportunity_id && opportunityTitles.get(proposal.opportunity_id) ? (
          <Link to={`/crm/funil?oportunidade=${proposal.opportunity_id}`} className={LINK}>{opportunityTitles.get(proposal.opportunity_id)}</Link>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { key: "status", header: "Situação", kind: "select", readOnly: true, sortValue: (proposal) => statusLabel(displayProposalStatus(proposal, today)), render: (proposal) => <StatusBadge status={displayProposalStatus(proposal, today)} /> },
    { key: "value", header: "Total", kind: "money", placeholder: "valor do item", render: (proposal) => <span className="tabular-nums">{formatCurrency(Number(proposal.value ?? 0))}</span> },
    {
      key: "valid_until",
      header: "Validade",
      kind: "date",
      render: (proposal) => <span className={cn("whitespace-nowrap", displayProposalStatus(proposal, today) === "expirada" ? "font-semibold text-destructive" : "text-muted-foreground")}>{formatDay(proposal.valid_until)}</span>,
    },
    { key: "payment_terms", header: "Condição", kind: "text", placeholder: "do cliente" },
  ];

  async function save(changes: EditableTableChanges<Proposal>) {
    const result = await saveProposalRows(await getDb(), companyId, actor, changes);
    const titles = new Map(proposals.map((proposal) => [proposal.id, proposal.title ?? formatSequence("proposals", proposal.number)]));
    for (const id of result.updated) await audit("proposal.updated", "proposal", id, `Proposta editada: ${titles.get(id) ?? ""}`);
    for (const [index, id] of result.created.entries()) await audit("proposal.created", "proposal", id, `Proposta criada (rascunho): ${changes.created[index]?.title ?? ""}`);
    invalidate("proposals");
  }

  return (
    <EditableTable<Proposal>
      resource="proposals"
      title={title}
      label={title}
      rows={proposals}
      columns={columns}
      loading={loading}
      onSave={save}
      onRefresh={() => refreshQueries(qc, ["proposals", "proposal"])}
      newRow={() => (customerId ? { customer_id: customerId } : {})}
      emptyMessage={emptyMessage ?? "Nenhuma proposta"}
      rowActions={(proposal) => (
        <button type="button" className={ROW_ACTION} aria-label={`Abrir proposta ${formatSequence("proposals", proposal.number)}`} onClick={() => navigate(`/crm/propostas/${proposal.id}`)}>
          <ExternalLink size={13} /> Abrir
        </button>
      )}
    />
  );
}
