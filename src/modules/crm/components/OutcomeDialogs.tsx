import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getDb } from "@/lib/db/client";
import { loseOpportunity, winOpportunity } from "@/lib/crm/convert";
import { fetchProposals, saveCustomer } from "@/lib/crm/queries";
import { formatSequence } from "@/lib/db/sequence";
import { formatCurrency } from "@/lib/utils";
import type { Opportunity } from "@/types";
import { BTN_PRIMARY, BTN_SECONDARY, INPUT, LINK, SELECT, TEXTAREA } from "./ui";
import { errorText, Modal } from "./Modal";
import { useAudit, useCrmSession, useCustomers, useInvalidateCrm } from "./useCrm";

interface WinDialogProps {
  opportunity: Opportunity;
  /** Proposta já escolhida (ex.: a que acabou de ser aceita no editor). */
  proposalId?: string | null;
  onClose: () => void;
  onWon?: (result: { customerId: string; salesOrderId: string | null }) => void;
}

/**
 * Ganhar a oportunidade: escolhe o cliente (o da oportunidade, outro existente ou um novo), a proposta que fecha o
 * negócio e se gera o pedido de venda em rascunho (só com permissão de criar pedido).
 */
export function WinDialog({ opportunity, proposalId, onClose, onWon }: WinDialogProps) {
  const { companyId, userId, can } = useCrmSession();
  const invalidate = useInvalidateCrm();
  const audit = useAudit();
  const { data: customers = [] } = useCustomers();
  const { data: proposals = [] } = useQuery({
    queryKey: ["proposals", companyId, "opportunity", opportunity.id],
    queryFn: async () => fetchProposals(await getDb(), companyId, { opportunityId: opportunity.id }),
  });
  const closable = proposals.filter((proposal) => ["aceita", "enviada", "expirada"].includes(proposal.status));
  const defaultProposal = proposalId ?? closable.find((proposal) => proposal.status === "aceita")?.id ?? "";
  const fromLead = !!opportunity.lead_id && !opportunity.customer_id;
  const [customerChoice, setCustomerChoice] = useState<string>(opportunity.customer_id ?? (fromLead ? "__lead" : "__new"));
  const [customerName, setCustomerName] = useState(opportunity.title);
  const [proposalChoice, setProposalChoice] = useState<string | null>(null);
  const canCreateOrder = can("create", "sales_orders");
  const [createOrder, setCreateOrder] = useState(canCreateOrder);
  const [result, setResult] = useState<{ customerId: string; salesOrderId: string | null } | null>(null);
  const chosenProposal = proposalChoice ?? defaultProposal;

  const mutation = useMutation({
    mutationFn: async () => {
      const db = await getDb();
      // Cliente novo é cadastrado aqui, para valer o nome digitado (sem isso, o lead ou o cliente da oportunidade teriam prioridade).
      const customerId =
        customerChoice === "__new"
          ? await saveCustomer(db, companyId, { name: customerName, type: "PJ", owner_id: opportunity.owner_id ?? userId, source: opportunity.source ?? null })
          : customerChoice === "__lead"
            ? null
            : customerChoice;
      const outcome = await winOpportunity(db, opportunity.id, userId, {
        customerId,
        proposalId: chosenProposal || null,
        createSalesOrder: canCreateOrder && createOrder,
      });
      await audit("opportunity.won", "opportunity", opportunity.id, `Oportunidade ganha: ${opportunity.title}`, { newValue: outcome });
      return outcome;
    },
    onSuccess: (outcome) => {
      invalidate();
      setResult(outcome);
      onWon?.(outcome);
    },
  });

  if (result) {
    return (
      <Modal title="Oportunidade ganha" onClose={onClose} footer={<button type="button" onClick={onClose} className={BTN_PRIMARY}>Fechar</button>}>
        <div className="space-y-3 text-sm">
          <p>
            <strong>{opportunity.title}</strong> foi marcada como ganha.
          </p>
          <p>
            Cliente: <Link to={`/crm/clientes/${result.customerId}`} className={LINK} onClick={onClose}>abrir a ficha</Link>
          </p>
          {result.salesOrderId ? (
            <p>
              Pedido de venda criado em rascunho: <Link to={`/sales/pedidos/${result.salesOrderId}`} className={LINK} onClick={onClose}>abrir o pedido</Link>
            </p>
          ) : (
            <p className="text-muted-foreground">Nenhum pedido de venda foi gerado{chosenProposal ? "." : " (sem proposta aceita)."}</p>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Ganhar oportunidade"
      description={`${opportunity.title} · ${formatCurrency(Number(opportunity.value ?? 0))}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={BTN_SECONDARY}>Cancelar</button>
          <button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending || (customerChoice === "__new" && !customerName.trim())} className={BTN_PRIMARY}>
            Marcar como ganha
          </button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <label className="block space-y-1.5 font-medium">
          Cliente
          <select value={customerChoice} onChange={(event) => setCustomerChoice(event.target.value)} className={`${SELECT} w-full font-normal`}>
            {fromLead && <option value="__lead">Do lead (usa o cadastro que já existir ou cria um com os dados do lead)</option>}
            <option value="__new">Cadastrar cliente novo</option>
            {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
          </select>
        </label>
        {customerChoice === "__new" && (
          <label className="block space-y-1.5 font-medium">
            Nome do cliente novo
            <input value={customerName} onChange={(event) => setCustomerName(event.target.value)} className={`${INPUT} font-normal`} />
          </label>
        )}
        <label className="block space-y-1.5 font-medium">
          Proposta que fecha o negócio
          <select value={chosenProposal} onChange={(event) => setProposalChoice(event.target.value)} className={`${SELECT} w-full font-normal`}>
            <option value="">Nenhuma</option>
            {closable.map((proposal) => (
              <option key={proposal.id} value={proposal.id}>
                {formatSequence("proposals", proposal.number)} · {proposal.title ?? "Sem título"} · {formatCurrency(Number(proposal.value ?? 0))} ({proposal.status})
              </option>
            ))}
          </select>
          <span className="block text-xs font-normal text-muted-foreground">A proposta escolhida fica como aceita.</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={canCreateOrder && createOrder && !!chosenProposal} disabled={!canCreateOrder || !chosenProposal} onChange={(event) => setCreateOrder(event.target.checked)} className="mt-0.5" />
          <span>
            Gerar pedido de venda em rascunho com os itens da proposta
            {!canCreateOrder && <span className="block text-xs text-muted-foreground">Seu papel não cria pedidos de venda; o setor de vendas pode gerar depois.</span>}
          </span>
        </label>
        {mutation.error && <p role="alert" className="text-destructive">{errorText(mutation.error)}</p>}
      </div>
    </Modal>
  );
}

const LOSS_REASONS = ["Preço", "Concorrência", "Sem orçamento", "Sem resposta", "Adiou a decisão", "Não era o perfil"];

export function LoseDialog({ opportunity, onClose, onLost }: { opportunity: Opportunity; onClose: () => void; onLost?: () => void }) {
  const { userId } = useCrmSession();
  const invalidate = useInvalidateCrm();
  const audit = useAudit();
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const text = [reason, details.trim()].filter(Boolean).join(": ");

  const mutation = useMutation({
    mutationFn: async () => {
      await loseOpportunity(await getDb(), opportunity.id, userId, text);
      await audit("opportunity.lost", "opportunity", opportunity.id, `Oportunidade perdida: ${opportunity.title}`, { newValue: { lost_reason: text } });
    },
    onSuccess: () => {
      invalidate("opportunities", "activities", "customers");
      onLost?.();
      onClose();
    },
  });

  return (
    <Modal
      title="Perder oportunidade"
      description={opportunity.title}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={BTN_SECONDARY}>Cancelar</button>
          <button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending || !text} className={BTN_PRIMARY}>Marcar como perdida</button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <label className="block space-y-1.5 font-medium">
          Motivo
          <select value={reason} onChange={(event) => setReason(event.target.value)} className={`${SELECT} w-full font-normal`}>
            <option value="">Escolha o motivo…</option>
            {LOSS_REASONS.map((item) => <option key={item} value={item}>{item}</option>)}
            <option value="Outro">Outro</option>
          </select>
        </label>
        <label className="block space-y-1.5 font-medium">
          Detalhes
          <textarea value={details} onChange={(event) => setDetails(event.target.value)} rows={3} className={`${TEXTAREA} font-normal`} placeholder="O que aconteceu? (ajuda a melhorar as próximas propostas)" />
        </label>
        {mutation.error && <p role="alert" className="text-destructive">{errorText(mutation.error)}</p>}
      </div>
    </Modal>
  );
}
