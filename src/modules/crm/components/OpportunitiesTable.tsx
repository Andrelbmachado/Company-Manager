// Oportunidades numa tabela editável (lista e aba da ficha do cliente). Editar muda título, cliente, etapa aberta, valor,
// probabilidade, fechamento previsto e responsável; fechar continua sendo por Ganhar/Perder no painel de detalhes, que
// abre logo abaixo da tabela.
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { saveOpportunityRows } from "@/lib/commercial/crmEdits";
import { getDb } from "@/lib/db/client";
import { OPEN_STAGES, STAGE_LABELS } from "@/lib/crm/queries";
import { cn, formatCurrency, formatDay, todayIso } from "@/lib/utils";
import { ROW_ACTION, refreshQueries, useEditActor } from "@/modules/catalog/components/inline";
import type { Opportunity } from "@/types";
import { OpportunityPanel } from "./OpportunityPanel";
import { LINK } from "./ui";
import { useAudit, useCompanyUsers, useCrmSession, useCustomerMap, useInvalidateCrm } from "./useCrm";

interface OpportunitiesTableProps {
  opportunities: Opportunity[];
  loading?: boolean;
  /** Cliente fixo (ficha): sem a coluna Cliente e as linhas novas já vêm ligadas a ele. */
  customerId?: string;
  title?: string;
  emptyMessage?: string;
  /** Oportunidade com o painel de detalhes aberto (controlado por quem chama, ex.: ?oportunidade= na URL). */
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function OpportunitiesTable({ opportunities, loading, customerId, title = "Oportunidades", emptyMessage, selectedId, onSelect }: OpportunitiesTableProps) {
  const { companyId, userId } = useCrmSession();
  const actor = useEditActor();
  const qc = useQueryClient();
  const invalidate = useInvalidateCrm();
  const audit = useAudit();
  const { data: customerList = [], map: customers } = useCustomerMap();
  const { data: users = [], names } = useCompanyUsers();
  const today = todayIso();

  const customerColumn: EditableColumn<Opportunity> = {
    key: "customer_id",
    header: "Cliente",
    kind: "select",
    width: 200,
    options: customerList.map((customer) => ({ value: customer.id, label: customer.name })),
    render: (opp) => {
      const customer = opp.customer_id ? customers.get(opp.customer_id) : null;
      return customer ? <Link to={`/crm/clientes/${customer.id}`} className={LINK}>{customer.name}</Link> : <span className="text-muted-foreground">{opp.lead_id ? "Definido ao ganhar" : "—"}</span>;
    },
  };
  const columns: EditableColumn<Opportunity>[] = [
    {
      key: "title",
      header: "Oportunidade",
      kind: "text",
      required: true,
      width: 220,
      render: (opp) => (
        <button type="button" className={LINK} onClick={() => onSelect(selectedId === opp.id ? null : opp.id)}>{opp.title}</button>
      ),
    },
    ...(customerId ? [] : [customerColumn]),
    { key: "stage", header: "Etapa", kind: "select", required: true, options: OPEN_STAGES.map((stage) => ({ value: stage, label: STAGE_LABELS[stage] })), render: (opp) => <StatusBadge status={opp.stage} /> },
    { key: "value", header: "Valor", kind: "money", render: (opp) => <span className="tabular-nums">{formatCurrency(Number(opp.value ?? 0))}</span> },
    { key: "probability", header: "Prob. (%)", kind: "number", width: 90, placeholder: "da etapa", render: (opp) => <span className="tabular-nums">{opp.probability}%</span> },
    {
      key: "expected_close_date",
      header: "Fechamento",
      kind: "date",
      render: (opp) => {
        const late = opp.status === "open" && opp.expected_close_date && opp.expected_close_date.slice(0, 10) < today;
        return <span className={cn("whitespace-nowrap", late ? "font-semibold text-destructive" : "text-muted-foreground")}>{opp.status === "open" ? formatDay(opp.expected_close_date) : `${STAGE_LABELS[opp.stage]} em ${formatDay(opp.closed_at)}`}</span>;
      },
    },
    { key: "owner_id", header: "Responsável", kind: "select", options: users.map((user) => ({ value: user.id, label: user.name })), render: (opp) => <span className="text-muted-foreground">{opp.owner_id ? names.get(opp.owner_id) ?? "—" : "—"}</span> },
    { key: "source", header: "Origem", kind: "text", placeholder: "Ex.: Indicação" },
  ];

  async function save(changes: EditableTableChanges<Opportunity>) {
    const result = await saveOpportunityRows(await getDb(), companyId, actor, changes);
    const byId = new Map(opportunities.map((opp) => [opp.id, opp]));
    for (const patch of changes.updated) {
      const before = byId.get(patch.id);
      if (!before) continue;
      if (patch.stage && patch.stage !== before.stage) {
        await audit("opportunity.stage_changed", "opportunity", before.id, `${before.title}: ${STAGE_LABELS[before.stage]} → ${STAGE_LABELS[patch.stage]}`, { oldValue: { stage: before.stage }, newValue: { stage: patch.stage } });
      } else {
        await audit("opportunity.updated", "opportunity", before.id, `Oportunidade editada: ${patch.title ?? before.title}`, { oldValue: before, newValue: patch });
      }
    }
    for (const [index, id] of result.created.entries()) await audit("opportunity.created", "opportunity", id, `Oportunidade criada: ${changes.created[index]?.title ?? ""}`);
    invalidate("opportunities", "activities");
  }

  return (
    <div className="space-y-4">
      <EditableTable<Opportunity>
        resource="opportunities"
        title={title}
        label={title}
        rows={opportunities}
        columns={columns}
        loading={loading}
        onSave={save}
        onRefresh={() => refreshQueries(qc, ["opportunities", "crm-activities"])}
        newRow={() => ({ stage: "novo", owner_id: userId, ...(customerId ? { customer_id: customerId } : {}) })}
        emptyMessage={emptyMessage ?? "Nenhuma oportunidade. Use Adicionar ou converta um lead da prospecção."}
        rowActions={(opp) => (
          <button type="button" className={ROW_ACTION} aria-label={`Detalhes de ${opp.title}`} aria-pressed={selectedId === opp.id} onClick={() => onSelect(selectedId === opp.id ? null : opp.id)}>
            <Info size={13} /> Detalhes
          </button>
        )}
      />
      {selectedId && <OpportunityPanel key={selectedId} opportunityId={selectedId} onClose={() => onSelect(null)} />}
    </div>
  );
}
