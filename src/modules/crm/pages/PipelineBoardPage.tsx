import { useMemo, useState, type DragEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { List, Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { fold, OPEN_STAGES, OPPORTUNITY_STAGES, pipelineSummary, STAGE_LABELS, type Stage } from "@/lib/crm/queries";
import { cn, formatCurrency, formatDay, todayIso } from "@/lib/utils";
import type { Opportunity } from "@/types";
import { daysFromToday, initialsOf, localDay } from "../components/format";
import { errorText } from "../components/Modal";
import { OpportunityForm } from "../components/OpportunityForm";
import { OpportunityPanel, useMoveStage } from "../components/OpportunityPanel";
import { LoseDialog, WinDialog } from "../components/OutcomeDialogs";
import { BTN_PRIMARY, BTN_SECONDARY, SELECT } from "../components/ui";
import { crmKeys, useCompanyUsers, useCrmSession, useCustomerMap, useOpportunities } from "../components/useCrm";

/** Dias para trás que as colunas Ganho e Perdido mostram (o resto fica na lista de oportunidades). */
const CLOSED_WINDOW_DAYS = 30;

/**
 * Funil de vendas: quadro por etapa, com arrastar entre colunas, totais e valor ponderado. "Adicionar" de uma coluna e os
 * detalhes do cartão abrem na própria página, acima do quadro; soltar em Ganho/Perdido pede a confirmação do fechamento.
 */
export default function PipelineBoardPage() {
  const { companyId, userId, can } = useCrmSession();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { data: opportunities = [], isLoading } = useOpportunities();
  const { map: customers } = useCustomerMap();
  const { data: users = [], names } = useCompanyUsers();
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("");
  const [creating, setCreating] = useState<Stage | null>(null);
  const [winning, setWinning] = useState<Opportunity | null>(null);
  const [losing, setLosing] = useState<Opportunity | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Stage | null>(null);
  const move = useMoveStage();
  const canEdit = can("edit", "opportunities");
  const selected = params.get("oportunidade");
  const today = todayIso();
  const closedSince = daysFromToday(-CLOSED_WINDOW_DAYS);

  const visible = useMemo(() => {
    const term = fold(search.trim());
    const ownerId = owner === "me" ? userId : owner;
    return opportunities.filter((opp) => {
      if (ownerId && opp.owner_id !== ownerId) return false;
      if (!term) return true;
      const customer = opp.customer_id ? customers.get(opp.customer_id)?.name : null;
      return [opp.title, customer, opp.source].some((field) => fold(field).includes(term));
    });
  }, [opportunities, customers, search, owner, userId]);
  const summary = useMemo(() => pipelineSummary(visible), [visible]);
  const monthStart = `${today.slice(0, 8)}01`;
  // closed_at/updated_at são instantes UTC: comparar pelo dia local, não pelo prefixo da string.
  const wonThisMonth = visible.filter((opp) => opp.status === "won" && localDay(opp.closed_at) >= monthStart);

  const columns = OPPORTUNITY_STAGES.map((stage) => {
    const all = visible.filter((opp) => opp.stage === stage);
    const closed = stage === "ganho" || stage === "perdido";
    const shown = closed ? all.filter((opp) => localDay(opp.closed_at ?? opp.updated_at) >= closedSince) : all;
    const sorted = [...shown].sort((a, b) =>
      closed ? String(b.closed_at ?? "").localeCompare(String(a.closed_at ?? "")) : String(a.expected_close_date ?? "9999").localeCompare(String(b.expected_close_date ?? "9999")),
    );
    return { stage, items: sorted, hidden: all.length - shown.length };
  });

  const open = (id: string | null) =>
    setParams((current) => {
      const copy = new URLSearchParams(current);
      if (id) copy.set("oportunidade", id);
      else copy.delete("oportunidade");
      return copy;
    });

  function drop(event: DragEvent, stage: Stage) {
    event.preventDefault();
    setOver(null);
    const id = event.dataTransfer.getData("text/plain") || dragging;
    setDragging(null);
    const opp = opportunities.find((item) => item.id === id);
    if (!opp || !canEdit) return;
    // Soltar na própria coluna não faz nada: em Ganho/Perdido reabriria o diálogo e a perda regravaria motivo e data.
    if (opp.stage === stage && (opp.status === "open" || stage === "ganho" || stage === "perdido")) return;
    if (stage === "ganho") return setWinning(opp);
    if (stage === "perdido") return setLosing(opp);
    // Otimista: o cartão muda de coluna já; a lista é recarregada quando a gravação termina (ou falha).
    qc.setQueryData<Opportunity[]>(crmKeys.opportunities(companyId), (current) =>
      current?.map((item) => (item.id === opp.id ? { ...item, stage, status: "open" } : item)),
    );
    move.mutate({ opportunity: opp, stage });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Funil de vendas"
        description={canEdit ? "Arraste os cartões entre as etapas. Solte em Ganho ou Perdido para fechar." : "Oportunidades por etapa"}
        actions={
          <>
            <Link to="/opportunities" className={BTN_SECONDARY}><List size={14} /> Lista</Link>
            {can("create", "opportunities") && <button type="button" onClick={() => setCreating("novo")} className={BTN_PRIMARY}><Plus size={14} /> Nova oportunidade</button>}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Em aberto" value={formatCurrency(summary.open.total)} />
        <StatCard title="Ponderado" value={formatCurrency(summary.open.weighted)} />
        <StatCard title="Taxa de ganho" value={summary.winRate == null ? "—" : `${Math.round(summary.winRate * 100)}%`} />
        <StatCard title="Ganhos no mês" value={formatCurrency(wonThisMonth.reduce((sum, opp) => sum + Number(opp.value ?? 0), 0))} />
      </div>

      <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar por título, cliente, origem...">
        <select value={owner} onChange={(event) => setOwner(event.target.value)} aria-label="Filtrar por responsável" className={SELECT}>
          <option value="">Todos os responsáveis</option>
          <option value="me">Minhas oportunidades</option>
          {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
        </select>
      </PageToolbar>

      {move.error && <p role="alert" className="text-sm text-destructive">Não foi possível mover: {errorText(move.error)}</p>}

      {creating && <OpportunityForm key={creating} defaults={{ stage: creating }} onClose={() => setCreating(null)} onSaved={(id) => open(id)} />}
      {selected && <OpportunityPanel key={selected} opportunityId={selected} onClose={() => open(null)} />}

      {isLoading ? (
        <div className="h-72 animate-pulse rounded-xl bg-muted/30" />
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2" role="list" aria-label="Etapas do funil">
          {columns.map(({ stage, items, hidden }) => {
            const totals = summary.byStage[stage];
            const closed = !OPEN_STAGES.includes(stage);
            return (
              <section
                key={stage}
                role="listitem"
                aria-label={`${STAGE_LABELS[stage]}: ${totals.count} oportunidade(s)`}
                onDragOver={(event) => {
                  if (!canEdit || !dragging) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  if (over !== stage) setOver(stage);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver((current) => (current === stage ? null : current));
                }}
                onDrop={(event) => drop(event, stage)}
                className={cn("flex w-72 shrink-0 flex-col rounded-xl border bg-muted/20 transition-colors", over === stage && "border-primary bg-primary/5")}
              >
                <header className="space-y-1 border-b px-3 py-2.5">
                  <div className="flex items-center justify-between">
                    <StatusBadge status={stage} />
                    <span className="text-xs font-medium text-muted-foreground">{totals.count}</span>
                  </div>
                  <p className="text-sm font-semibold tabular-nums">{formatCurrency(totals.total)}</p>
                  {!closed && <p className="text-xs text-muted-foreground tabular-nums">Ponderado {formatCurrency(totals.weighted)}</p>}
                </header>
                <div className="flex min-h-24 flex-1 flex-col gap-2 p-2">
                  {items.map((opp) => {
                    const customer = opp.customer_id ? customers.get(opp.customer_id) : null;
                    const late = opp.status === "open" && opp.expected_close_date && opp.expected_close_date.slice(0, 10) < today;
                    return (
                      // div com role=button: <button> arrastável não funciona em todos os motores (Firefox).
                      <div
                        key={opp.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`${opp.title}, ${formatCurrency(Number(opp.value ?? 0))}`}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            open(opp.id);
                          }
                        }}
                        draggable={canEdit}
                        onDragStart={(event) => {
                          event.dataTransfer.setData("text/plain", opp.id);
                          event.dataTransfer.effectAllowed = "move";
                          setDragging(opp.id);
                        }}
                        onDragEnd={() => {
                          setDragging(null);
                          setOver(null);
                        }}
                        onClick={() => open(opp.id)}
                        className={cn(
                          "w-full rounded-lg border bg-card p-2.5 text-left text-sm shadow-sm transition hover:border-primary/50",
                          canEdit && "cursor-grab active:cursor-grabbing",
                          dragging === opp.id && "opacity-50",
                        )}
                      >
                        <p className="line-clamp-2 font-medium">{opp.title}</p>
                        {customer && <p className="truncate text-xs text-muted-foreground">{customer.name}</p>}
                        <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                          <span className="font-semibold tabular-nums">{formatCurrency(Number(opp.value ?? 0))}</span>
                          <span className="text-muted-foreground tabular-nums">{opp.probability}%</span>
                        </div>
                        <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span className={cn(late && "font-semibold text-destructive")}>
                            {closed ? formatDay(opp.closed_at) : opp.expected_close_date ? `Fecha ${formatDay(opp.expected_close_date)}` : "Sem previsão"}
                          </span>
                          {opp.owner_id && (
                            <span title={names.get(opp.owner_id) ?? undefined} className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">
                              {initialsOf(names.get(opp.owner_id))}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {items.length === 0 && <p className="px-1 py-4 text-center text-xs text-muted-foreground">{closed ? `Nada nos últimos ${CLOSED_WINDOW_DAYS} dias` : "Nenhuma oportunidade"}</p>}
                  {hidden > 0 && <Link to="/opportunities" className="px-1 text-center text-xs text-muted-foreground hover:text-foreground">+ {hidden} mais antiga(s) na lista</Link>}
                  {!closed && can("create", "opportunities") && (
                    <button type="button" onClick={() => setCreating(stage)} className="mt-auto rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                      <Plus size={12} className="mr-1 inline" /> Adicionar
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {winning && <WinDialog opportunity={winning} onClose={() => setWinning(null)} />}
      {losing && <LoseDialog opportunity={losing} onClose={() => setLosing(null)} />}
    </div>
  );
}
