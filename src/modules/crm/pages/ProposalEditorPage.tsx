import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { v4 as uuidv4 } from "uuid";
import { ArrowLeft, FileDown, FilePen, Plus, Save, Trash2, Trophy } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { getDb } from "@/lib/db/client";
import {
  deleteProposal,
  displayProposalStatus,
  fetchProposal,
  fetchProposalItems,
  priceFor,
  PROPOSAL_ACTION_LABELS,
  proposalActions,
  saveProposal,
  setProposalStatus,
  type ProposalAction,
} from "@/lib/crm/proposals";
import { fetchPriceListItems, parseMoneyInput } from "@/lib/crm/queries";
import { formatSequence } from "@/lib/db/sequence";
import { lineTotal, orderTotals } from "@/lib/money";
import { cn, formatCurrency, formatDay, todayIso } from "@/lib/utils";
import type { Opportunity, Product, Proposal, ProposalItem } from "@/types";
import { ActivityTimeline } from "../components/Activities";
import { daysFromToday, moneyInput } from "../components/format";
import { ConfirmDialog, errorText } from "../components/Modal";
import { WinDialog } from "../components/OutcomeDialogs";
import { PdfPreviewDialog } from "../components/PdfPreviewDialog";
import { BTN_DANGER, BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CARD, INPUT, SELECT, TEXTAREA } from "../components/ui";
import { useAudit, useContacts, useCrmSession, useCustomers, useInvalidateCrm, useOpportunities, useProducts } from "../components/useCrm";

interface EditorItem {
  key: string;
  product_id: string | null;
  description: string;
  unit: string;
  qty: string;
  unit_price: string;
  discount: string;
  tax_rate: string;
  /** Preço segue a tabela do cliente (vira false quando a pessoa digita o preço). */
  autoPrice: boolean;
}

interface Header {
  title: string;
  customer_id: string;
  contact_id: string;
  opportunity_id: string;
  valid_until: string;
  payment_terms: string;
  notes: string;
  discount: string;
}

const decimal = (value: number) => String(value).replace(".", ",");

/** Texto digitado → número, sem lançar erro no meio da digitação (inválido = 0). */
function safeMoney(text: string): number {
  try {
    return parseMoneyInput(text) ?? 0;
  } catch {
    return 0;
  }
}
/** Mesma leitura de quantidade/percentual que saveProposal usa ("1,5" = 1.5; com vírgula, ponto é milhar). */
function safeNumber(text: string): number {
  const compact = text.trim().replace(/\s/g, "");
  const value = Number(compact.includes(",") ? compact.replace(/\./g, "").replace(",", ".") : compact);
  return Number.isFinite(value) ? value : 0;
}

function fromItem(item: ProposalItem): EditorItem {
  return {
    key: item.id,
    product_id: item.product_id ?? null,
    description: item.description,
    unit: item.unit ?? "un",
    qty: decimal(Number(item.qty)),
    unit_price: moneyInput(Number(item.unit_price)),
    discount: Number(item.discount ?? 0) ? moneyInput(Number(item.discount)) : "",
    tax_rate: Number(item.tax_rate ?? 0) ? decimal(Number(item.tax_rate)) : "",
    autoPrice: false,
  };
}

/** Editor da proposta. :id = "nova" cria (aceita ?oportunidade= e ?cliente=). */
export default function ProposalEditorPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const { companyId, can } = useCrmSession();
  const isNew = id === "nova";
  const customers = useCustomers();
  const opportunities = useOpportunities(can("view", "opportunities"));
  const products = useProducts();
  const proposal = useQuery({
    queryKey: ["proposal", companyId, id],
    queryFn: async () => {
      const db = await getDb();
      const row = await fetchProposal(db, companyId, id);
      return row ? { row, items: await fetchProposalItems(db, companyId, id) } : null;
    },
    enabled: !isNew,
  });

  const loading = customers.isLoading || products.isLoading || (can("view", "opportunities") && opportunities.isLoading) || (!isNew && proposal.isLoading);
  if (loading) return <div className="h-72 animate-pulse rounded-xl bg-muted/30" />;
  if (isNew && !can("create", "proposals")) {
    return (
      <div>
        <PageHeader title="Nova proposta" />
        <EmptyState icon={FilePen} title="Sem permissão para criar propostas" />
      </div>
    );
  }
  if (!isNew && !proposal.data) {
    return (
      <div>
        <PageHeader title="Proposta" />
        <EmptyState icon={FilePen} title="Proposta não encontrada" description="Ela pode ter sido excluída." action={<Link to="/crm/propostas" className={BTN_SECONDARY}><ArrowLeft size={14} /> Voltar às propostas</Link>} />
      </div>
    );
  }

  const row = proposal.data?.row ?? null;
  const opp = isNew ? opportunities.data?.find((item) => item.id === params.get("oportunidade")) ?? null : null;
  const customerParam = isNew ? params.get("cliente") : null;
  return (
    <ProposalEditor
      // Remonta (e relê o formulário) quando muda a versão ou o status; salvar o rascunho mantém o que está na tela.
      key={row ? `${row.id}:${row.version}:${row.status}` : "nova"}
      proposal={row}
      items={proposal.data?.items ?? []}
      defaults={{ opportunity: opp, customerId: opp?.customer_id ?? customerParam ?? null }}
      products={products.data ?? []}
      opportunities={opportunities.data ?? []}
    />
  );
}

interface ProposalEditorProps {
  proposal: Proposal | null;
  items: ProposalItem[];
  defaults: { opportunity: Opportunity | null; customerId: string | null };
  products: Product[];
  opportunities: Opportunity[];
}

function ProposalEditor({ proposal, items: savedItems, defaults, products, opportunities }: ProposalEditorProps) {
  const { companyId, userId, can } = useCrmSession();
  const navigate = useNavigate();
  const invalidate = useInvalidateCrm();
  const audit = useAudit();
  const { data: customers = [] } = useCustomers();
  const today = todayIso();
  const [header, setHeader] = useState<Header>(() => {
    const customer = customers.find((item) => item.id === (proposal?.customer_id ?? defaults.customerId));
    return {
      title: proposal?.title ?? defaults.opportunity?.title ?? "",
      customer_id: proposal?.customer_id ?? defaults.customerId ?? "",
      contact_id: proposal?.contact_id ?? defaults.opportunity?.contact_id ?? "",
      opportunity_id: proposal?.opportunity_id ?? defaults.opportunity?.id ?? "",
      valid_until: proposal ? proposal.valid_until?.slice(0, 10) ?? "" : daysFromToday(15),
      payment_terms: proposal?.payment_terms ?? customer?.payment_terms ?? "",
      notes: proposal?.notes ?? "",
      discount: Number(proposal?.discount ?? 0) ? moneyInput(Number(proposal?.discount)) : "",
    };
  });
  const [items, setItems] = useState<EditorItem[]>(() => savedItems.map(fromItem));
  const [dirty, setDirty] = useState(false);
  const [dialog, setDialog] = useState<"pdf" | "delete" | "win" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { data: contacts = [] } = useContacts(header.customer_id || undefined);
  const customer = customers.find((item) => item.id === header.customer_id) ?? null;
  const { data: listItems = [] } = useQuery({
    queryKey: ["price-list-items", companyId, customer?.price_list_id ?? "-"],
    queryFn: async () => fetchPriceListItems(await getDb(), companyId, customer?.price_list_id),
    enabled: !!customer?.price_list_id,
  });
  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);

  const status = proposal ? displayProposalStatus(proposal, today) : "rascunho";
  const editable = proposal ? proposal.status === "rascunho" && can("edit", "proposals") : can("create", "proposals");
  const linkedOpportunity = opportunities.find((item) => item.id === header.opportunity_id) ?? null;
  const opportunityOptions = opportunities.filter((item) => item.id === header.opportunity_id || (item.status === "open" && (!header.customer_id || !item.customer_id || item.customer_id === header.customer_id)));

  const numeric = items.map((item) => ({ qty: safeNumber(item.qty), unit_price: safeMoney(item.unit_price), discount: safeMoney(item.discount), tax_rate: safeNumber(item.tax_rate) }));
  // Mesma conta de proposalTotals/saveProposal, com os valores já lidos sem erro de digitação.
  const totals = orderTotals(numeric, { discount: safeMoney(header.discount) });

  const change = (patch: Partial<Header>) => {
    setHeader((current) => ({ ...current, ...patch }));
    setDirty(true);
  };
  const changeItem = (key: string, patch: Partial<EditorItem>) => {
    setItems((current) =>
      current.map((item) => {
        if (item.key !== key) return item;
        const next = { ...item, ...patch };
        // Quantidade nova pode mudar a faixa da tabela de preço.
        if (next.autoPrice && next.product_id && "qty" in patch) {
          const product = productById.get(next.product_id);
          if (product) next.unit_price = moneyInput(priceFor(product.id, Number(product.price ?? 0), safeNumber(next.qty) || 1, listItems));
        }
        return next;
      }),
    );
    setDirty(true);
  };
  function chooseCustomer(customerId: string) {
    const chosen = customers.find((item) => item.id === customerId);
    change({ customer_id: customerId, contact_id: "", payment_terms: header.payment_terms || chosen?.payment_terms || "" });
  }
  function chooseOpportunity(opportunityId: string) {
    const chosen = opportunities.find((item) => item.id === opportunityId);
    change({
      opportunity_id: opportunityId,
      ...(chosen?.customer_id && !header.customer_id ? { customer_id: chosen.customer_id, contact_id: chosen.contact_id ?? "" } : {}),
      ...(chosen && !header.title.trim() ? { title: chosen.title } : {}),
    });
  }
  function addProduct(productId: string) {
    const product = productById.get(productId);
    if (!product) return;
    setItems((current) => [
      ...current,
      {
        key: uuidv4(),
        product_id: product.id,
        description: product.name,
        unit: product.unit || "un",
        qty: "1",
        unit_price: moneyInput(priceFor(product.id, Number(product.price ?? 0), 1, listItems)),
        discount: "",
        tax_rate: Number(product.tax_rate ?? 0) ? decimal(Number(product.tax_rate)) : "",
        autoPrice: true,
      },
    ]);
    setDirty(true);
  }
  function addFreeItem() {
    setItems((current) => [...current, { key: uuidv4(), product_id: null, description: "", unit: "un", qty: "1", unit_price: "", discount: "", tax_rate: "", autoPrice: false }]);
    setDirty(true);
  }

  const save = useMutation({
    mutationFn: async () => {
      const id = await saveProposal(
        await getDb(),
        companyId,
        userId,
        {
          title: header.title,
          customer_id: header.customer_id || null,
          contact_id: header.contact_id || null,
          opportunity_id: header.opportunity_id || null,
          valid_until: header.valid_until || null,
          payment_terms: header.payment_terms,
          notes: header.notes,
          discount: header.discount,
          items: items.map((item) => ({ product_id: item.product_id, description: item.description, unit: item.unit, qty: item.qty, unit_price: item.unit_price, discount: item.discount, tax_rate: item.tax_rate })),
        },
        proposal?.id,
      );
      await audit(proposal ? "proposal.updated" : "proposal.created", "proposal", id, `${proposal ? "Proposta editada" : "Proposta criada"}: ${header.title || "sem título"}`, { newValue: { header, items: items.length } });
      return id;
    },
    onSuccess: (id) => {
      invalidate("proposals", "opportunities");
      setDirty(false);
      if (!proposal) navigate(`/crm/propostas/${id}`, { replace: true });
      else setNotice("Proposta salva.");
    },
  });

  const transition = useMutation({
    mutationFn: async (action: ProposalAction) => {
      if (!proposal) return action;
      await setProposalStatus(await getDb(), companyId, proposal.id, action, userId);
      await audit(`proposal.${action}`, "proposal", proposal.id, `${PROPOSAL_ACTION_LABELS[action]}: ${formatSequence("proposals", proposal.number)}`);
      return action;
    },
    onSuccess: (action) => {
      invalidate("proposals", "opportunities", "activities");
      setNotice(null);
      if (action === "accept" && linkedOpportunity?.status === "open" && can("edit", "opportunities")) setDialog("win");
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!proposal) return;
      await deleteProposal(await getDb(), companyId, proposal.id);
      await audit("proposal.deleted", "proposal", proposal.id, `Proposta excluída: ${formatSequence("proposals", proposal.number)}`, { oldValue: proposal });
    },
    onSuccess: () => {
      invalidate("proposals");
      navigate("/crm/propostas", { replace: true });
    },
  });

  const actions = proposal && can("edit", "proposals") ? proposalActions(proposal.status) : [];
  const error = save.error ?? transition.error;
  return (
    <div className="space-y-6">
      <div>
        <Link to="/crm/propostas" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={14} /> Propostas</Link>
        <PageHeader
          className="pb-0 pt-2"
          title={proposal ? `${formatSequence("proposals", proposal.number)}${Number(proposal.version ?? 1) > 1 ? ` · versão ${proposal.version}` : ""}` : "Nova proposta"}
          description={proposal ? [header.title, customer?.name].filter(Boolean).join(" · ") : "Monte a proposta com itens do catálogo e condições"}
          actions={
            <>
              {proposal && <StatusBadge status={status} />}
              {proposal && (
                <button type="button" onClick={() => setDialog("pdf")} disabled={dirty} title={dirty ? "Salve as alterações antes de gerar o PDF" : undefined} className={BTN_SECONDARY}>
                  <FileDown size={14} /> PDF
                </button>
              )}
              {actions.map((action) => (
                <button key={action} type="button" onClick={() => transition.mutate(action)} disabled={transition.isPending || (dirty && action === "send")} className={action === "accept" ? BTN_PRIMARY : BTN_SECONDARY}>
                  {PROPOSAL_ACTION_LABELS[action]}
                </button>
              ))}
              {proposal?.status === "aceita" && linkedOpportunity?.status === "open" && can("edit", "opportunities") && (
                <button type="button" onClick={() => setDialog("win")} className={BTN_PRIMARY}><Trophy size={14} /> Ganhar oportunidade</button>
              )}
              {editable && (
                <button type="button" onClick={() => save.mutate()} disabled={save.isPending || (!!proposal && !dirty)} className={BTN_PRIMARY}>
                  <Save size={14} /> {proposal ? "Salvar" : "Criar proposta"}
                </button>
              )}
            </>
          }
        />
      </div>

      {proposal && proposal.status !== "rascunho" && (
        <p className="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          {status === "expirada" ? "A validade desta proposta venceu. " : ""}
          Só o rascunho pode ser editado.{actions.includes("revise") ? " Use “Revisar (nova versão)” para mudar itens ou condições." : ""}
          {proposal.sent_at ? ` Enviada em ${formatDay(proposal.sent_at)}.` : ""}
          {proposal.decided_at && proposal.status !== "enviada" ? ` Resposta em ${formatDay(proposal.decided_at)}.` : ""}
        </p>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{errorText(error)}</p>}
      {notice && !dirty && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}

      <section className={cn(CARD, "grid gap-4 p-5 text-sm sm:grid-cols-2 lg:grid-cols-3")} aria-label="Dados da proposta">
        <label className="space-y-1.5 font-medium lg:col-span-2">
          Título
          <input value={header.title} onChange={(event) => change({ title: event.target.value })} disabled={!editable} className={cn(INPUT, "font-normal")} placeholder="Ex.: Site institucional com agendamento" />
        </label>
        <label className="space-y-1.5 font-medium">
          Validade
          <input type="date" value={header.valid_until} onChange={(event) => change({ valid_until: event.target.value })} disabled={!editable} className={cn(INPUT, "font-normal")} />
        </label>
        <label className="space-y-1.5 font-medium">
          Cliente
          <select value={header.customer_id} onChange={(event) => chooseCustomer(event.target.value)} disabled={!editable} className={cn(SELECT, "w-full font-normal")}>
            <option value="">Sem cliente</option>
            {customers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="space-y-1.5 font-medium">
          Contato
          <select value={header.contact_id} onChange={(event) => change({ contact_id: event.target.value })} disabled={!editable || !header.customer_id} className={cn(SELECT, "w-full font-normal")}>
            <option value="">Sem contato</option>
            {contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}
          </select>
        </label>
        {can("view", "opportunities") && (
          <label className="space-y-1.5 font-medium">
            Oportunidade
            <select value={header.opportunity_id} onChange={(event) => chooseOpportunity(event.target.value)} disabled={!editable} className={cn(SELECT, "w-full font-normal")}>
              <option value="">Sem oportunidade</option>
              {opportunityOptions.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
          </label>
        )}
        <label className="space-y-1.5 font-medium sm:col-span-2 lg:col-span-3">
          Condições de pagamento
          <input value={header.payment_terms} onChange={(event) => change({ payment_terms: event.target.value })} disabled={!editable} className={cn(INPUT, "font-normal")} placeholder="Ex.: 50% na aprovação e 50% na entrega" />
        </label>
        {customer?.price_list_id && <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-3">Preços dos produtos pela tabela de preço do cliente.</p>}
      </section>

      <section className={cn(CARD, "overflow-hidden")} aria-label="Itens da proposta">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
          <h2 className="font-semibold">Itens</h2>
          {editable && (
            <div className="flex flex-wrap items-center gap-2">
              <select value="" onChange={(event) => addProduct(event.target.value)} aria-label="Adicionar item do catálogo" className={SELECT}>
                <option value="">+ Item do catálogo…</option>
                {products.map((product) => <option key={product.id} value={product.id}>{product.sku ? `${product.sku} · ` : ""}{product.name} ({formatCurrency(Number(product.price ?? 0))})</option>)}
              </select>
              <button type="button" onClick={addFreeItem} className={BTN_SECONDARY}><Plus size={14} /> Item avulso</button>
            </div>
          )}
        </div>
        {items.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">{editable ? "Adicione itens do catálogo ou um item avulso." : "Sem itens."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Descrição</th>
                  <th className="w-20 px-2 py-2 font-medium">Un.</th>
                  <th className="w-24 px-2 py-2 font-medium">Qtd.</th>
                  <th className="w-32 px-2 py-2 font-medium">Preço unit.</th>
                  <th className="w-28 px-2 py-2 font-medium">Desconto</th>
                  <th className="w-20 px-2 py-2 font-medium">Imp. %</th>
                  <th className="w-32 px-3 py-2 text-right font-medium">Total</th>
                  {editable && <th className="w-10 px-2 py-2"><span className="sr-only">Remover</span></th>}
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((item, index) => (
                  <tr key={item.key} className="align-top">
                    <td className="px-3 py-2">
                      <input value={item.description} onChange={(event) => changeItem(item.key, { description: event.target.value })} disabled={!editable} aria-label={`Descrição do item ${index + 1}`} className={INPUT} />
                      {item.product_id && <p className="mt-1 text-xs text-muted-foreground">Catálogo{productById.get(item.product_id)?.sku ? ` · ${productById.get(item.product_id)?.sku}` : ""}</p>}
                    </td>
                    <td className="px-2 py-2"><input value={item.unit} onChange={(event) => changeItem(item.key, { unit: event.target.value })} disabled={!editable} aria-label={`Unidade do item ${index + 1}`} className={INPUT} /></td>
                    <td className="px-2 py-2"><input value={item.qty} inputMode="decimal" onChange={(event) => changeItem(item.key, { qty: event.target.value })} disabled={!editable} aria-label={`Quantidade do item ${index + 1}`} className={cn(INPUT, "text-right")} /></td>
                    <td className="px-2 py-2"><input value={item.unit_price} inputMode="decimal" onChange={(event) => changeItem(item.key, { unit_price: event.target.value, autoPrice: false })} disabled={!editable} aria-label={`Preço unitário do item ${index + 1}`} className={cn(INPUT, "text-right")} placeholder="0,00" /></td>
                    <td className="px-2 py-2"><input value={item.discount} inputMode="decimal" onChange={(event) => changeItem(item.key, { discount: event.target.value })} disabled={!editable} aria-label={`Desconto do item ${index + 1} em reais`} className={cn(INPUT, "text-right")} placeholder="0,00" /></td>
                    <td className="px-2 py-2"><input value={item.tax_rate} inputMode="decimal" onChange={(event) => changeItem(item.key, { tax_rate: event.target.value })} disabled={!editable} aria-label={`Imposto do item ${index + 1} em %`} className={cn(INPUT, "text-right")} placeholder="0" /></td>
                    <td className="px-3 py-2 pt-4 text-right font-medium tabular-nums">{formatCurrency(lineTotal(numeric[index]!.qty, numeric[index]!.unit_price, numeric[index]!.discount))}</td>
                    {editable && (
                      <td className="px-2 py-2 pt-3">
                        <button type="button" onClick={() => { setItems((current) => current.filter((other) => other.key !== item.key)); setDirty(true); }} className={BTN_GHOST} aria-label={`Remover o item ${index + 1}`}>
                          <Trash2 size={13} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-col items-end gap-1.5 border-t px-5 py-4 text-sm">
          <div className="flex w-72 justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{formatCurrency(totals.subtotal)}</span></div>
          <label className="flex w-72 items-center justify-between gap-3">
            <span className="text-muted-foreground">Desconto geral (R$)</span>
            <input value={header.discount} inputMode="decimal" onChange={(event) => change({ discount: event.target.value })} disabled={!editable} className={cn(INPUT, "h-8 w-32 text-right")} placeholder="0,00" />
          </label>
          {totals.tax_total > 0 && <div className="flex w-72 justify-between"><span className="text-muted-foreground">Impostos</span><span className="tabular-nums">{formatCurrency(totals.tax_total)}</span></div>}
          <div className="flex w-72 justify-between border-t pt-2 text-base font-semibold"><span>Total</span><span className="tabular-nums">{formatCurrency(totals.total)}</span></div>
        </div>
      </section>

      <section className={cn(CARD, "p-5")} aria-label="Observações">
        <label className="block space-y-1.5 text-sm font-medium">
          Observações (saem no PDF)
          <textarea value={header.notes} onChange={(event) => change({ notes: event.target.value })} disabled={!editable} rows={4} className={cn(TEXTAREA, "font-normal")} placeholder="Escopo, prazos de entrega, garantias..." />
        </label>
      </section>

      {proposal && can("view", "crm_activities") && (
        <ActivityTimeline filter={{ entityType: "proposal", entityId: proposal.id }} entity={{ type: "proposal", id: proposal.id, customerId: proposal.customer_id }} title="Histórico da proposta" />
      )}

      {proposal && can("delete", "proposals") && (
        <div className="border-t pt-4">
          <button type="button" onClick={() => setDialog("delete")} className={BTN_DANGER}><Trash2 size={14} /> Excluir proposta</button>
        </div>
      )}

      {dialog === "pdf" && proposal && <PdfPreviewDialog proposalId={proposal.id} onClose={() => setDialog(null)} />}
      {dialog === "win" && linkedOpportunity && proposal && <WinDialog opportunity={linkedOpportunity} proposalId={proposal.id} onClose={() => setDialog(null)} />}
      {dialog === "delete" && proposal && (
        <ConfirmDialog
          title="Excluir proposta"
          message={`Excluir a proposta ${formatSequence("proposals", proposal.number)}? O número não será reaproveitado.`}
          confirmLabel="Excluir"
          danger
          busy={remove.isPending}
          error={errorText(remove.error)}
          onConfirm={() => remove.mutate()}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
