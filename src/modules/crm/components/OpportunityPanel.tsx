import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { FilePlus2, ThumbsDown, Trash2, Trophy } from "lucide-react";
import { IconButton, TABLE_ICONS } from "@/components/shared/table";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { confirmAction } from "@/lib/confirm";
import { getDb } from "@/lib/db/client";
import { moveOpportunityStage } from "@/lib/crm/convert";
import { displayProposalStatus } from "@/lib/crm/proposals";
import { deleteOpportunity, OPEN_STAGES, STAGE_LABELS, type Stage } from "@/lib/crm/queries";
import { formatSequence } from "@/lib/db/sequence";
import { cn, formatCurrency, formatDay, todayIso } from "@/lib/utils";
import type { Opportunity } from "@/types";
import { ActivityTimeline } from "./Activities";
import { InfoGrid as DetailGrid, InfoItem as DetailItem, InlinePanel } from "@/modules/catalog/components/inline";
import { errorText } from "./Modal";
import { OpportunityForm } from "./OpportunityForm";
import { LoseDialog, WinDialog } from "./OutcomeDialogs";
import { BTN_DANGER, BTN_PRIMARY, BTN_SECONDARY, LINK, SELECT } from "./ui";
import { useAudit, useCompanyUsers, useContacts, useCrmSession, useCustomerMap, useInvalidateCrm, useOpportunities, useProposals } from "./useCrm";

/** Hook do funil: mover etapa (com registro de auditoria). */
export function useMoveStage() {
  const { userId } = useCrmSession();
  const invalidate = useInvalidateCrm();
  const audit = useAudit();
  return useMutation({
    mutationFn: async ({ opportunity, stage }: { opportunity: Opportunity; stage: Stage }) => {
      await moveOpportunityStage(await getDb(), opportunity.id, stage, userId);
      await audit("opportunity.stage_changed", "opportunity", opportunity.id, `${opportunity.title}: ${STAGE_LABELS[opportunity.stage]} → ${STAGE_LABELS[stage]}`, {
        oldValue: { stage: opportunity.stage },
        newValue: { stage },
      });
    },
    onSettled: () => invalidate("opportunities", "activities"),
  });
}

/**
 * Detalhes da oportunidade na própria página (lista, funil, ficha do cliente): etapa, Ganhar/Perder, propostas, linha do
 * tempo e "Editar oportunidade", que troca os dados pelo formulário no mesmo painel. Ganhar e Perder continuam
 * pedindo confirmação (cliente, proposta, motivo) antes de fechar.
 */
export function OpportunityPanel({ opportunityId, onClose }: { opportunityId: string; onClose: () => void }) {
  const { companyId, can } = useCrmSession();
  const invalidate = useInvalidateCrm();
  const audit = useAudit();
  const { data: opportunities, isLoading } = useOpportunities();
  const opportunity = opportunities?.find((item) => item.id === opportunityId) ?? null;
  const { map: customers } = useCustomerMap();
  const { names } = useCompanyUsers();
  const { data: contacts = [] } = useContacts(opportunity?.customer_id ?? undefined);
  const { data: allProposals = [] } = useProposals(can("view", "proposals"));
  const [dialog, setDialog] = useState<"win" | "lose" | null>(null);
  const [editing, setEditing] = useState(false);
  const move = useMoveStage();
  const remove = useMutation({
    mutationFn: async (target: Opportunity) => {
      await deleteOpportunity(await getDb(), companyId, target.id);
      await audit("opportunity.deleted", "opportunity", target.id, `Oportunidade excluída: ${target.title}`, { oldValue: target });
    },
    onSuccess: () => {
      invalidate("opportunities");
      onClose();
    },
  });

  if (!opportunity) {
    return (
      <InlinePanel title={isLoading ? "Carregando…" : "Oportunidade não encontrada"} subtitle="Oportunidade" onClose={onClose}>
        {isLoading ? <div className="h-40 animate-pulse rounded-lg bg-muted/30" /> : <p className="text-sm text-muted-foreground">Ela pode ter sido excluída.</p>}
      </InlinePanel>
    );
  }

  const canEdit = can("edit", "opportunities");
  const open = opportunity.status === "open";
  const proposals = allProposals.filter((proposal) => proposal.opportunity_id === opportunity.id);
  const customer = opportunity.customer_id ? customers.get(opportunity.customer_id) : null;
  const contact = contacts.find((item) => item.id === opportunity.contact_id);
  const today = todayIso();
  const late = open && opportunity.expected_close_date && opportunity.expected_close_date.slice(0, 10) < today;

  return (
    <InlinePanel
      title={opportunity.title}
      subtitle={`Oportunidade · ${STAGE_LABELS[opportunity.stage]}`}
      onClose={onClose}
      actions={canEdit && !editing ? <IconButton label="Editar oportunidade" icon={TABLE_ICONS.edit} onClick={() => setEditing(true)} /> : undefined}
    >
      <div className="space-y-6">
        {editing && <OpportunityForm key={opportunity.id} opportunity={opportunity} onClose={() => setEditing(false)} />}
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">{open ? "Etapa" : "Reabrir em"}</span>
              <select
                value={open ? opportunity.stage : ""}
                disabled={move.isPending}
                onChange={(event) => event.target.value && move.mutate({ opportunity, stage: event.target.value as Stage })}
                className={SELECT}
                aria-label={open ? "Mover para a etapa" : "Reabrir a oportunidade na etapa"}
              >
                {!open && <option value="">Escolha a etapa…</option>}
                {OPEN_STAGES.map((stage) => <option key={stage} value={stage}>{STAGE_LABELS[stage]}</option>)}
              </select>
            </label>
            {open && (
              <>
                <button type="button" onClick={() => setDialog("win")} className={BTN_PRIMARY}><Trophy size={14} /> Ganhar</button>
                <button type="button" onClick={() => setDialog("lose")} className={BTN_SECONDARY}><ThumbsDown size={14} /> Perder</button>
              </>
            )}
            {move.error && <p role="alert" className="w-full text-sm text-destructive">{errorText(move.error)}</p>}
          </div>
        )}

        <DetailGrid>
          <DetailItem label="Etapa" value={<StatusBadge status={opportunity.stage} />} />
          <DetailItem label="Valor" value={formatCurrency(Number(opportunity.value ?? 0))} />
          <DetailItem label="Probabilidade" value={`${opportunity.probability}%`} />
          <DetailItem label="Valor ponderado" value={formatCurrency((Number(opportunity.value ?? 0) * Number(opportunity.probability ?? 0)) / 100)} />
          <DetailItem label="Fechamento previsto" value={opportunity.expected_close_date ? <span className={cn(late && "font-semibold text-destructive")}>{formatDay(opportunity.expected_close_date)}{late ? " (atrasado)" : ""}</span> : null} />
          <DetailItem label="Responsável" value={opportunity.owner_id ? names.get(opportunity.owner_id) : null} />
          <DetailItem label="Cliente" value={customer ? <Link to={`/crm/clientes/${customer.id}`} className={LINK}>{customer.name}</Link> : opportunity.lead_id ? "Definido ao ganhar (lead)" : null} />
          <DetailItem label="Contato" value={contact ? [contact.name, contact.phone ?? contact.email].filter(Boolean).join(" · ") : null} />
          <DetailItem label="Origem" value={opportunity.source} />
          <DetailItem label="Lead" value={opportunity.lead_id ? <Link to="/leads" className={LINK}>Ver na prospecção</Link> : null} />
          {!open && <DetailItem label={opportunity.status === "won" ? "Ganha em" : "Perdida em"} value={formatDay(opportunity.closed_at)} />}
          {opportunity.status === "lost" && <DetailItem label="Motivo da perda" value={opportunity.lost_reason} />}
        </DetailGrid>
        {opportunity.notes && <DetailItem label="Observações" value={<span className="whitespace-pre-line">{opportunity.notes}</span>} />}

        {can("view", "proposals") && (
          <section aria-label="Propostas" className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Propostas</h3>
              {can("create", "proposals") && open && (
                <Link to={`/crm/propostas/nova?oportunidade=${opportunity.id}`} className={cn(BTN_SECONDARY, "py-1 text-xs")}>
                  <FilePlus2 size={13} /> Nova proposta
                </Link>
              )}
            </div>
            {proposals.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma proposta ainda.</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {proposals.map((proposal) => (
                  <li key={proposal.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <Link to={`/crm/propostas/${proposal.id}`} className={cn(LINK, "min-w-0 truncate")}>
                      {formatSequence("proposals", proposal.number)} · {proposal.title ?? "Sem título"}
                      {Number(proposal.version ?? 1) > 1 ? ` (v${proposal.version})` : ""}
                    </Link>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="tabular-nums">{formatCurrency(Number(proposal.value ?? 0))}</span>
                      <StatusBadge status={displayProposalStatus(proposal, today)} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {can("view", "crm_activities") && (
          <ActivityTimeline filter={{ entityType: "opportunity", entityId: opportunity.id }} entity={{ type: "opportunity", id: opportunity.id, customerId: opportunity.customer_id }} title="Linha do tempo" />
        )}

        {can("delete", "opportunities") && (
          <div className="border-t pt-4">
            <button
              type="button"
              disabled={remove.isPending}
              onClick={async () => {
                if (await confirmAction(`Excluir ${opportunity.title}? As propostas e atividades ligadas continuam no histórico.`, { title: "Excluir oportunidade", okLabel: "Excluir" })) remove.mutate(opportunity);
              }}
              className={BTN_DANGER}
            >
              <Trash2 size={14} /> Excluir oportunidade
            </button>
            {remove.error && <p role="alert" className="mt-2 text-sm text-destructive">{errorText(remove.error)}</p>}
          </div>
        )}
      </div>

      {dialog === "win" && <WinDialog opportunity={opportunity} onClose={() => setDialog(null)} />}
      {dialog === "lose" && <LoseDialog opportunity={opportunity} onClose={() => setDialog(null)} />}
    </InlinePanel>
  );
}
