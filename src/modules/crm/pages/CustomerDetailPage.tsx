import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FilePlus2, Target, UserRound } from "lucide-react";
import { IconButton, TABLE_ICONS } from "@/components/shared/table";
import { EmptyState } from "@/components/shared/EmptyState";
import { FileAttachments } from "@/components/shared/FileAttachments";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { TabList, TabPanel } from "@/components/shared/Tabs";
import { getDb } from "@/lib/db/client";
import { activityState } from "@/lib/crm/activities";
import { displayProposalStatus } from "@/lib/crm/proposals";
import { customerFinance, fetchCustomer, pipelineSummary } from "@/lib/crm/queries";
import { cn, formatCurrency, formatDay, todayIso } from "@/lib/utils";
import { InfoGrid as DetailGrid, InfoItem as DetailItem } from "@/modules/catalog/components/inline";
import { ActivityTimeline } from "../components/Activities";
import { ContactsTable } from "../components/ContactsTable";
import { CustomerForm, formatAddress } from "../components/CustomerForm";
import { errorText } from "../components/Modal";
import { OpportunitiesTable } from "../components/OpportunitiesTable";
import { OpportunityForm } from "../components/OpportunityForm";
import { ProposalsTable } from "../components/ProposalsTable";
import { TagEditor } from "../components/Tags";
import { BTN_PRIMARY, BTN_SECONDARY, CARD, LINK } from "../components/ui";
import { useActivities, useCompanyUsers, useContacts, useCrmSession, useOpportunities, usePriceLists, useProposals } from "../components/useCrm";

type TabId = "resumo" | "contatos" | "oportunidades" | "propostas" | "atividades" | "documentos" | "financeiro";

/**
 * Ficha do cliente. :id = "nova" abre o cadastro de um cliente novo. O cadastro é editado no próprio lugar ("Editar
 * cadastro" troca o bloco pelo formulário) e as abas Contatos, Oportunidades, Propostas e Atividades são tabelas editáveis.
 */
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
        <CustomerForm onClose={() => navigate("/crm")} onSaved={(newId) => navigate(`/crm/clientes/${newId}`, { replace: true })} />
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
              {can("create", "opportunities") && <button type="button" onClick={() => { setNewOpportunity(true); setTab("oportunidades"); }} className={BTN_SECONDARY}><Target size={14} /> Nova oportunidade</button>}
              {can("create", "proposals") && <Link to={`/crm/propostas/nova?cliente=${customer.id}`} className={BTN_SECONDARY}><FilePlus2 size={14} /> Nova proposta</Link>}
              {can("edit", "customers") && !editing && <IconButton label="Editar cadastro" icon={TABLE_ICONS.edit} variant="primary" onClick={() => { setEditing(true); setTab("resumo"); }} />}
            </>
          }
        />
        <TagEditor entityType="customer" entityId={customer.id} canEdit={can("edit", "customers")} />
      </div>

      <div><TabList tabs={tabs} value={tab} onChange={setTab} label="Seções da ficha do cliente" idPrefix="cliente" /></div>

      {/* Resumo e as abas com tabela ficam montados (só escondidos): trocar de aba não perde em silêncio o cadastro em edição nem o rascunho das tabelas. */}
      <div hidden={tab !== "resumo"}>
        <TabPanel idPrefix="cliente" id="resumo">
          <SummaryTab customerId={customer.id} />
          {editing ? (
            <CustomerForm customer={customer} onClose={() => setEditing(false)} />
          ) : (
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
          )}
        </TabPanel>
      </div>
      <div hidden={tab !== "contatos"}>
        <TabPanel idPrefix="cliente" id="contatos"><ContactsTab customerId={customer.id} /></TabPanel>
      </div>
      {can("view", "opportunities") && (
        <div hidden={tab !== "oportunidades"}>
          <TabPanel idPrefix="cliente" id="oportunidades"><OpportunitiesTab customerId={customer.id} creating={newOpportunity} onCreatingChange={setNewOpportunity} /></TabPanel>
        </div>
      )}
      {can("view", "proposals") && (
        <div hidden={tab !== "propostas"}>
          <TabPanel idPrefix="cliente" id="propostas"><ProposalsTab customerId={customer.id} /></TabPanel>
        </div>
      )}
      {can("view", "crm_activities") && (
        <div hidden={tab !== "atividades"}>
          <TabPanel idPrefix="cliente" id="atividades">
            <ActivityTimeline filter={{ customerId: customer.id }} entity={{ type: "customer", id: customer.id, customerId: customer.id }} showEntity title="Linha do tempo do cliente" />
          </TabPanel>
        </div>
      )}
      {tab === "documentos" && (
        <TabPanel idPrefix="cliente" id="documentos"><FileAttachments entityType="customer" entityId={customer.id} canEdit={can("attach", "customers")} /></TabPanel>
      )}
      {tab === "financeiro" && (
        <TabPanel idPrefix="cliente" id="financeiro"><FinanceTab customerId={customer.id} creditLimit={customer.credit_limit ?? null} paymentTerms={customer.payment_terms ?? null} /></TabPanel>
      )}

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
  const primary = contacts[0];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {can("view", "opportunities") && <StatCard title="Em negociação" value={formatCurrency(summary.open.total)} />}
      {can("view", "opportunities") && <StatCard title="Negócios ganhos" value={won.length} />}
      {can("view", "proposals") && <StatCard title="Propostas em aberto" value={openProposals.length} />}
      {can("view", "crm_activities") && (
        <StatCard
          title="Próximo passo"
          value={next ? <span className={cn(activityState(next) === "atrasada" && "text-destructive")}>{next.subject ?? "Atividade"}</span> : "Nenhum agendado"}
        />
      )}
      <StatCard title="Contato principal" value={primary?.name ?? "Nenhum"} />
    </div>
  );
}

function ContactsTab({ customerId }: { customerId: string }) {
  const { data: contacts = [], isLoading } = useContacts(customerId);
  return <ContactsTable contacts={contacts} loading={isLoading} customerId={customerId} />;
}

function OpportunitiesTab({ customerId, creating, onCreatingChange }: { customerId: string; creating: boolean; onCreatingChange: (next: boolean) => void }) {
  const { data: opportunities = [], isLoading } = useOpportunities();
  const [selected, setSelected] = useState<string | null>(null);
  const own = opportunities.filter((opp) => opp.customer_id === customerId);
  return (
    <section className="space-y-4" aria-label="Oportunidades">
      {creating && <OpportunityForm defaults={{ customer_id: customerId }} onClose={() => onCreatingChange(false)} onSaved={(id) => setSelected(id)} />}
      <OpportunitiesTable opportunities={own} loading={isLoading} customerId={customerId} selectedId={selected} onSelect={setSelected} emptyMessage="Nenhuma oportunidade deste cliente. Use Adicionar para abrir uma." />
    </section>
  );
}

function ProposalsTab({ customerId }: { customerId: string }) {
  const { can } = useCrmSession();
  const { data: proposals = [], isLoading } = useProposals();
  const own = proposals.filter((proposal) => proposal.customer_id === customerId);
  return (
    <section className="space-y-3" aria-label="Propostas">
      {can("create", "proposals") && (
        <div className="flex justify-end">
          <Link to={`/crm/propostas/nova?cliente=${customerId}`} className={BTN_SECONDARY}><FilePlus2 size={14} /> Proposta com itens do catálogo</Link>
        </div>
      )}
      <ProposalsTable proposals={own} loading={isLoading} customerId={customerId} emptyMessage="Nenhuma proposta deste cliente. Use Adicionar para criar o rascunho." />
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
        {seesInvoices && <StatCard title="Faturado" value={formatCurrency(data.invoiced)} />}
        {seesReceivables && (
          <>
            <StatCard title="Recebido" value={formatCurrency(data.received)} />
            <StatCard title="Em aberto" value={formatCurrency(data.open)} />
            <StatCard title="Vencido" value={<span className={cn(data.overdue > 0 && "text-destructive")}>{formatCurrency(data.overdue)}</span>} />
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
