import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, FilePlus2, Pencil, Plus, Star, Target, Trash2, UserRound } from "lucide-react";
import { DetailGrid, DetailItem } from "@/components/shared/DetailDrawer";
import { EmptyState } from "@/components/shared/EmptyState";
import { FileAttachments } from "@/components/shared/FileAttachments";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { TabList, TabPanel } from "@/components/shared/Tabs";
import { getDb } from "@/lib/db/client";
import { activityState } from "@/lib/crm/activities";
import { displayProposalStatus } from "@/lib/crm/proposals";
import { customerFinance, deleteContact, fetchCustomer, pipelineSummary, setPrimaryContact, STAGE_LABELS } from "@/lib/crm/queries";
import { formatSequence } from "@/lib/db/sequence";
import { cn, formatCurrency, formatDay, todayIso } from "@/lib/utils";
import type { Contact } from "@/types";
import { ActivityTimeline } from "../components/Activities";
import { ContactFormDialog } from "../components/ContactFormDialog";
import { CustomerFormDialog, formatAddress } from "../components/CustomerFormDialog";
import { formatWhen } from "../components/format";
import { ConfirmDialog, errorText } from "../components/Modal";
import { OpportunityDrawer } from "../components/OpportunityDrawer";
import { OpportunityFormDialog } from "../components/OpportunityFormDialog";
import { TagEditor } from "../components/Tags";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CARD, LINK, TD, TH } from "../components/ui";
import { useActivities, useAudit, useCompanyUsers, useContacts, useCrmSession, useInvalidateCrm, useOpportunities, usePriceLists, useProposals } from "../components/useCrm";

type TabId = "resumo" | "contatos" | "oportunidades" | "propostas" | "atividades" | "documentos" | "financeiro";

/** Ficha do cliente. :id = "nova" abre o cadastro de um cliente novo. */
export default function CustomerDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { can } = useCrmSession();

  if (id === "nova") {
    if (!can("create", "customers")) {
      return (
        <div>
          <PageHeader title="Novo cliente" />
          <EmptyState icon={UserRound} title="Sem permissão para cadastrar clientes" />
        </div>
      );
    }
    return (
      <div className="space-y-6">
        <PageHeader title="Novo cliente" description="Preencha o cadastro; depois você completa contatos, oportunidades e documentos na ficha." />
        <CustomerFormDialog onClose={() => navigate("/crm")} onSaved={(newId) => navigate(`/crm/clientes/${newId}`, { replace: true })} />
      </div>
    );
  }
  return <CustomerRecord key={id} id={id} />;
}

function CustomerRecord({ id }: { id: string }) {
  const { companyId, can } = useCrmSession();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState(false);
  const [newOpportunity, setNewOpportunity] = useState(false);
  const { names } = useCompanyUsers();
  const { data: priceLists = [] } = usePriceLists();
  const { data: customer, isLoading } = useQuery({
    queryKey: ["customer", companyId, id],
    queryFn: async () => fetchCustomer(await getDb(), companyId, id),
  });
  const { data: merged } = useQuery({
    queryKey: ["customer", companyId, customer?.merged_into_id ?? "-"],
    queryFn: async () => fetchCustomer(await getDb(), companyId, customer!.merged_into_id!),
    enabled: !!customer?.merged_into_id,
  });

  const tabs: { id: TabId; label: string }[] = [
    { id: "resumo", label: "Resumo" },
    { id: "contatos", label: "Contatos" },
    ...(can("view", "opportunities") ? [{ id: "oportunidades" as const, label: "Oportunidades" }] : []),
    ...(can("view", "proposals") ? [{ id: "propostas" as const, label: "Propostas" }] : []),
    ...(can("view", "crm_activities") ? [{ id: "atividades" as const, label: "Atividades" }] : []),
    { id: "documentos", label: "Documentos" },
    ...(can("view", "receivables") || can("view", "invoices") || can("view", "finance") ? [{ id: "financeiro" as const, label: "Financeiro" }] : []),
  ];
  const requested = params.get("aba") as TabId | null;
  const tab: TabId = tabs.some((item) => item.id === requested) ? (requested as TabId) : "resumo";
  const setTab = (next: TabId) => setParams((current) => {
    const copy = new URLSearchParams(current);
    if (next === "resumo") copy.delete("aba");
    else copy.set("aba", next);
    return copy;
  }, { replace: true });

  if (isLoading) return <div className="h-64 animate-pulse rounded-xl bg-muted/30" />;
  if (!customer) {
    return (
      <div>
        <PageHeader title="Ficha do cliente" />
        <EmptyState icon={UserRound} title="Cliente não encontrado" description="Ele pode ter sido excluído." action={<Link to="/crm" className={BTN_SECONDARY}><ArrowLeft size={14} /> Voltar aos clientes</Link>} />
      </div>
    );
  }
  if (customer.deleted_at) {
    return (
      <div>
        <PageHeader title="Ficha do cliente" />
        <EmptyState
          icon={UserRound}
          title={customer.merged_into_id ? `${customer.name} foi mesclado em outro cadastro` : `${customer.name} foi excluído`}
          description={customer.merged_into_id ? "O histórico dele (contatos, oportunidades, propostas e atividades) agora está no cadastro que ficou." : undefined}
          action={
            customer.merged_into_id ? (
              <Link to={`/crm/clientes/${customer.merged_into_id}`} className={BTN_PRIMARY}>Abrir {merged?.name ?? "o cadastro que ficou"}</Link>
            ) : (
              <Link to="/crm" className={BTN_SECONDARY}><ArrowLeft size={14} /> Voltar aos clientes</Link>
            )
          }
        />
      </div>
    );
  }

  const priceList = priceLists.find((list) => list.id === customer.price_list_id);
  return (
    <div className="space-y-6">
      <div>
        <Link to="/crm" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={14} /> Clientes</Link>
        <PageHeader
          className="pb-3 pt-2"
          title={customer.name}
          description={[customer.trade_name, customer.type === "PF" ? "Pessoa física" : "Pessoa jurídica", customer.segment].filter(Boolean).join(" · ")}
          actions={
            <>
              <StatusBadge status={customer.status} />
              {can("create", "opportunities") && <button type="button" onClick={() => setNewOpportunity(true)} className={BTN_SECONDARY}><Target size={14} /> Nova oportunidade</button>}
              {can("create", "proposals") && <Link to={`/crm/propostas/nova?cliente=${customer.id}`} className={BTN_SECONDARY}><FilePlus2 size={14} /> Nova proposta</Link>}
              {can("edit", "customers") && <button type="button" onClick={() => setEditing(true)} className={BTN_PRIMARY}><Pencil size={14} /> Editar</button>}
            </>
          }
        />
        <TagEditor entityType="customer" entityId={customer.id} canEdit={can("edit", "customers")} />
      </div>

      <div className="border-b overflow-x-auto"><TabList tabs={tabs} value={tab} onChange={setTab} label="Seções da ficha do cliente" idPrefix="cliente" /></div>

      <TabPanel idPrefix="cliente" id={tab}>
        {tab === "resumo" && (
          <>
            <SummaryTab customerId={customer.id} />
            <section className={cn(CARD, "p-5")} aria-label="Cadastro">
              <h2 className="mb-4 font-semibold">Cadastro</h2>
              <DetailGrid>
                <DetailItem label={customer.type === "PF" ? "CPF" : "CNPJ"} value={customer.document} />
                <DetailItem label="Inscrição estadual" value={customer.state_registration} />
                <DetailItem label="E-mail" value={customer.email ? <a href={`mailto:${customer.email}`} className={LINK}>{customer.email}</a> : null} />
                <DetailItem label="Telefone" value={customer.phone} />
                <DetailItem label="Site" value={customer.website} />
                <DetailItem label="Origem" value={customer.source} />
                <DetailItem label="Responsável" value={customer.owner_id ? names.get(customer.owner_id) : null} />
                <DetailItem label="Cliente desde" value={formatDay(customer.created_at)} />
                <DetailItem label="Condição de pagamento" value={customer.payment_terms} />
                <DetailItem label="Limite de crédito" value={customer.credit_limit != null ? formatCurrency(Number(customer.credit_limit)) : null} />
                <DetailItem label="Tabela de preço" value={priceList?.name ?? (customer.price_list_id ? "—" : "Preço do catálogo")} />
                <DetailItem label="Endereço" value={formatAddress(customer.address_json) || null} />
              </DetailGrid>
              {customer.notes && <div className="mt-4"><DetailItem label="Observações" value={<span className="whitespace-pre-line">{customer.notes}</span>} /></div>}
            </section>
          </>
        )}
        {tab === "contatos" && <ContactsTab customerId={customer.id} />}
        {tab === "oportunidades" && <OpportunitiesTab customerId={customer.id} />}
        {tab === "propostas" && <ProposalsTab customerId={customer.id} />}
        {tab === "atividades" && <ActivityTimeline filter={{ customerId: customer.id }} entity={{ type: "customer", id: customer.id, customerId: customer.id }} showEntity title="Linha do tempo do cliente" />}
        {tab === "documentos" && <FileAttachments entityType="customer" entityId={customer.id} canEdit={can("attach", "customers")} />}
        {tab === "financeiro" && <FinanceTab customerId={customer.id} creditLimit={customer.credit_limit ?? null} paymentTerms={customer.payment_terms ?? null} />}
      </TabPanel>

      {editing && <CustomerFormDialog customer={customer} onClose={() => setEditing(false)} />}
      {newOpportunity && <OpportunityFormDialog defaults={{ customer_id: customer.id }} onClose={() => setNewOpportunity(false)} onSaved={() => setTab("oportunidades")} />}
    </div>
  );
}

function SummaryTab({ customerId }: { customerId: string }) {
  const { can } = useCrmSession();
  const { data: opportunities = [] } = useOpportunities(can("view", "opportunities"));
  const { data: proposals = [] } = useProposals(can("view", "proposals"));
  const { data: activities = [] } = useActivities({ customerId }, can("view", "crm_activities"));
  const { data: contacts = [] } = useContacts(customerId);
  const own = opportunities.filter((opp) => opp.customer_id === customerId);
  const summary = pipelineSummary(own.filter((opp) => opp.status === "open"));
  const won = own.filter((opp) => opp.status === "won");
  const today = todayIso();
  const openProposals = proposals.filter((proposal) => proposal.customer_id === customerId && ["enviada", "rascunho"].includes(displayProposalStatus(proposal, today)));
  const next = activities.filter((activity) => !activity.done_at && activity.due_at).sort((a, b) => String(a.due_at).localeCompare(String(b.due_at)))[0];
  const last = activities.filter((activity) => activity.done_at).sort((a, b) => String(b.done_at).localeCompare(String(a.done_at)))[0];
  const primary = contacts[0];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {can("view", "opportunities") && <StatCard title="Em negociação" value={formatCurrency(summary.open.total)} kind="text" hint={`${summary.open.count} oportunidade(s) · ponderado ${formatCurrency(summary.open.weighted)}`} />}
      {can("view", "opportunities") && <StatCard title="Negócios ganhos" value={won.length} hint={formatCurrency(won.reduce((sum, opp) => sum + Number(opp.value ?? 0), 0))} />}
      {can("view", "proposals") && <StatCard title="Propostas em aberto" value={openProposals.length} hint={formatCurrency(openProposals.reduce((sum, proposal) => sum + Number(proposal.value ?? 0), 0))} />}
      {can("view", "crm_activities") && (
        <StatCard
          title="Próximo passo"
          kind="text"
          value={next ? <span className={cn(activityState(next) === "atrasada" && "text-destructive")}>{next.subject ?? "Atividade"}</span> : "Nenhum agendado"}
          hint={next ? `${formatWhen(next.due_at)}${activityState(next) === "atrasada" ? " · atrasado" : ""}` : last ? `Último contato: ${formatWhen(last.done_at)}` : "Registre a próxima ligação ou reunião"}
        />
      )}
      <StatCard title="Contato principal" kind="text" value={primary?.name ?? "Nenhum"} hint={primary ? [primary.role, primary.phone ?? primary.email].filter(Boolean).join(" · ") : "Cadastre na aba Contatos"} />
    </div>
  );
}

function ContactsTab({ customerId }: { customerId: string }) {
  const { companyId, can } = useCrmSession();
  const invalidate = useInvalidateCrm();
  const audit = useAudit();
  const { data: contacts = [], isLoading } = useContacts(customerId);
  const [editing, setEditing] = useState<Contact | "new" | null>(null);
  const [removing, setRemoving] = useState<Contact | null>(null);
  const canEdit = can("edit", "customers");
  const primary = useMutation({
    mutationFn: async (contact: Contact) => setPrimaryContact(await getDb(), companyId, contact.id),
    onSuccess: () => invalidate("contacts"),
  });
  const remove = useMutation({
    mutationFn: async (contact: Contact) => {
      await deleteContact(await getDb(), companyId, contact.id);
      await audit("contact.deleted", "contact", contact.id, `Contato excluído: ${contact.name}`);
    },
    onSuccess: () => {
      invalidate("contacts");
      setRemoving(null);
    },
  });

  return (
    <section className="space-y-3" aria-label="Contatos">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Contatos</h2>
        {canEdit && <button type="button" onClick={() => setEditing("new")} className={BTN_SECONDARY}><Plus size={14} /> Novo contato</button>}
      </div>
      {isLoading ? (
        <div className="h-24 animate-pulse rounded-lg bg-muted/30" />
      ) : contacts.length === 0 ? (
        <EmptyState icon={UserRound} title="Nenhum contato" description="Cadastre as pessoas com quem você fala neste cliente." className="py-8" />
      ) : (
        <div className={cn(CARD, "overflow-x-auto")}>
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className={TH}>Nome</th>
                <th className={TH}>Cargo</th>
                <th className={TH}>E-mail</th>
                <th className={TH}>Telefone / WhatsApp</th>
                <th className={TH}><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {contacts.map((contact) => (
                <tr key={contact.id}>
                  <td className={TD}>
                    <span className="flex items-center gap-1.5 font-medium">
                      {Number(contact.is_primary) === 1 && <Star size={13} className="fill-current text-status-warning" aria-label="Contato principal" />}
                      {contact.name}
                    </span>
                    {contact.notes && <p className="text-xs text-muted-foreground">{contact.notes}</p>}
                  </td>
                  <td className={cn(TD, "text-muted-foreground")}>{contact.role ?? "—"}</td>
                  <td className={cn(TD, "text-muted-foreground")}>{contact.email ? <a href={`mailto:${contact.email}`} className={LINK}>{contact.email}</a> : "—"}</td>
                  <td className={cn(TD, "text-muted-foreground")}>{[contact.phone, contact.whatsapp && contact.whatsapp !== contact.phone ? `WhatsApp ${contact.whatsapp}` : null].filter(Boolean).join(" · ") || "—"}</td>
                  <td className={cn(TD, "whitespace-nowrap text-right")}>
                    {canEdit && Number(contact.is_primary) !== 1 && <button type="button" onClick={() => primary.mutate(contact)} className={BTN_GHOST}>Tornar principal</button>}
                    {canEdit && <button type="button" onClick={() => setEditing(contact)} className={BTN_GHOST} aria-label={`Editar ${contact.name}`}><Pencil size={12} /></button>}
                    {canEdit && <button type="button" onClick={() => setRemoving(contact)} className={BTN_GHOST} aria-label={`Excluir ${contact.name}`}><Trash2 size={12} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <ContactFormDialog contact={editing === "new" ? null : editing} customerId={customerId} onClose={() => setEditing(null)} />}
      {removing && (
        <ConfirmDialog
          title="Excluir contato"
          message={`Excluir ${removing.name}?`}
          confirmLabel="Excluir"
          danger
          busy={remove.isPending}
          error={errorText(remove.error)}
          onConfirm={() => remove.mutate(removing)}
          onClose={() => setRemoving(null)}
        />
      )}
    </section>
  );
}

function OpportunitiesTab({ customerId }: { customerId: string }) {
  const { can } = useCrmSession();
  const { data: opportunities = [], isLoading } = useOpportunities();
  const { names } = useCompanyUsers();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const own = opportunities.filter((opp) => opp.customer_id === customerId);
  return (
    <section className="space-y-3" aria-label="Oportunidades">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Oportunidades</h2>
        {can("create", "opportunities") && <button type="button" onClick={() => setCreating(true)} className={BTN_SECONDARY}><Plus size={14} /> Nova oportunidade</button>}
      </div>
      {isLoading ? (
        <div className="h-24 animate-pulse rounded-lg bg-muted/30" />
      ) : own.length === 0 ? (
        <EmptyState icon={Target} title="Nenhuma oportunidade" className="py-8" />
      ) : (
        <div className={cn(CARD, "overflow-x-auto")}>
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className={TH}>Oportunidade</th>
                <th className={TH}>Etapa</th>
                <th className={cn(TH, "text-right")}>Valor</th>
                <th className={cn(TH, "text-right")}>Prob.</th>
                <th className={TH}>Fechamento</th>
                <th className={TH}>Responsável</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {own.map((opp) => (
                <tr key={opp.id} onClick={() => setSelected(opp.id)} className="cursor-pointer hover:bg-muted/20">
                  <td className={TD}><button type="button" className={LINK} onClick={(event) => { event.stopPropagation(); setSelected(opp.id); }}>{opp.title}</button></td>
                  <td className={TD}><StatusBadge status={opp.stage} /></td>
                  <td className={cn(TD, "text-right tabular-nums")}>{formatCurrency(Number(opp.value ?? 0))}</td>
                  <td className={cn(TD, "text-right tabular-nums")}>{opp.probability}%</td>
                  <td className={cn(TD, "text-muted-foreground")}>{opp.status === "open" ? formatDay(opp.expected_close_date) : `${STAGE_LABELS[opp.stage]} em ${formatDay(opp.closed_at)}`}</td>
                  <td className={cn(TD, "text-muted-foreground")}>{opp.owner_id ? names.get(opp.owner_id) ?? "—" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected && <OpportunityDrawer opportunityId={selected} onClose={() => setSelected(null)} />}
      {creating && <OpportunityFormDialog defaults={{ customer_id: customerId }} onClose={() => setCreating(false)} />}
    </section>
  );
}

function ProposalsTab({ customerId }: { customerId: string }) {
  const { can } = useCrmSession();
  const { data: proposals = [], isLoading } = useProposals();
  const own = proposals.filter((proposal) => proposal.customer_id === customerId);
  const today = todayIso();
  return (
    <section className="space-y-3" aria-label="Propostas">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Propostas</h2>
        {can("create", "proposals") && <Link to={`/crm/propostas/nova?cliente=${customerId}`} className={BTN_SECONDARY}><FilePlus2 size={14} /> Nova proposta</Link>}
      </div>
      {isLoading ? (
        <div className="h-24 animate-pulse rounded-lg bg-muted/30" />
      ) : own.length === 0 ? (
        <EmptyState icon={FilePlus2} title="Nenhuma proposta" className="py-8" />
      ) : (
        <div className={cn(CARD, "overflow-x-auto")}>
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className={TH}>Número</th>
                <th className={TH}>Título</th>
                <th className={TH}>Situação</th>
                <th className={cn(TH, "text-right")}>Total</th>
                <th className={TH}>Validade</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {own.map((proposal) => (
                <tr key={proposal.id}>
                  <td className={cn(TD, "whitespace-nowrap")}><Link to={`/crm/propostas/${proposal.id}`} className={LINK}>{formatSequence("proposals", proposal.number)}</Link></td>
                  <td className={TD}>{proposal.title ?? "—"}{Number(proposal.version ?? 1) > 1 && <span className="ml-1 text-xs text-muted-foreground">v{proposal.version}</span>}</td>
                  <td className={TD}><StatusBadge status={displayProposalStatus(proposal, today)} /></td>
                  <td className={cn(TD, "text-right tabular-nums")}>{formatCurrency(Number(proposal.value ?? 0))}</td>
                  <td className={cn(TD, "text-muted-foreground")}>{formatDay(proposal.valid_until)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function FinanceTab({ customerId, creditLimit, paymentTerms }: { customerId: string; creditLimit: number | null; paymentTerms: string | null }) {
  const { companyId, can } = useCrmSession();
  // Recebido, em aberto e vencido saem das contas a receber: quem só vê faturas (ex.: Comercial) fica com o faturado.
  const seesInvoices = can("view", "invoices");
  const seesReceivables = can("view", "receivables") || can("view", "finance");
  const today = todayIso();
  const { data, isLoading, error } = useQuery({
    queryKey: ["customer-finance", companyId, customerId, today],
    queryFn: async () => customerFinance(await getDb(), companyId, customerId, today),
  });
  if (isLoading) return <div className="h-24 animate-pulse rounded-lg bg-muted/30" />;
  if (error || !data) return <p role="alert" className="text-sm text-destructive">{errorText(error) ?? "Não foi possível carregar o financeiro."}</p>;
  const available = seesReceivables && creditLimit != null ? creditLimit - data.open : null;
  return (
    <section className="space-y-4" aria-label="Financeiro">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {seesInvoices && <StatCard title="Faturado" value={formatCurrency(data.invoiced)} kind="text" hint="faturas emitidas (sem as canceladas)" />}
        {seesReceivables && (
          <>
            <StatCard title="Recebido" value={formatCurrency(data.received)} kind="text" />
            <StatCard title="Em aberto" value={formatCurrency(data.open)} kind="text" hint={paymentTerms ? `Condição: ${paymentTerms}` : undefined} />
            <StatCard title="Vencido" value={<span className={cn(data.overdue > 0 && "text-destructive")}>{formatCurrency(data.overdue)}</span>} kind="text" hint={data.overdue > 0 ? "parcelas com vencimento antes de hoje" : "nada vencido"} />
          </>
        )}
      </div>
      {available != null && (
        <p className={cn("text-sm", available < 0 ? "font-semibold text-destructive" : "text-muted-foreground")}>
          Limite de crédito {formatCurrency(creditLimit ?? 0)} · disponível {formatCurrency(available)}
          {available < 0 ? " (acima do limite)" : ""}
        </p>
      )}
      {!seesReceivables && (
        <p className="text-sm text-muted-foreground">
          {creditLimit != null ? `Limite de crédito ${formatCurrency(creditLimit)}. ` : ""}
          {paymentTerms ? `Condição de pagamento: ${paymentTerms}. ` : ""}
          Recebimentos e valores vencidos aparecem para quem tem acesso ao financeiro.
        </p>
      )}
    </section>
  );
}
