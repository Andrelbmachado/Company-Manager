import { useState, type KeyboardEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, ClipboardCheck, Loader2, Plus, Printer, Trash2, XCircle } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { formatSequence } from "@/lib/db/sequence";
import { useRequiredSession } from "@/hooks/useSession";
import { usePermission } from "@/hooks/usePermission";
import { emit } from "@/lib/events/bus";
import { addCountItem, cancelInventoryCount, finishInventoryCount, loadInventoryCount, removeCountItem, setCountedQuantity, type InventoryCountLine } from "@/lib/inventory/counts";
import { loadStockSnapshot } from "@/lib/inventory/queries";
import { formatQty, roundQty } from "@/lib/inventory/stock";
import { lineTotal, sumMoney } from "@/lib/money";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { NewCountForm } from "../components/NewCountForm";
import { BUTTON_OUTLINE, BUTTON_PRIMARY, ErrorBanner, errorText, INPUT, inventoryKeys, normalizeSearch, parseDecimal, TableSkeleton, useInvalidateInventory } from "../components/inventoryUi";

type View = "todos" | "pendentes" | "divergentes";

function signed(value: number, unit?: string): string {
  if (value === 0) return formatQty(0, unit);
  return `${value > 0 ? "+" : "−"}${formatQty(Math.abs(value), unit)}`;
}

export default function InventoryCountPage() {
  const { id = "" } = useParams();
  const session = useRequiredSession();
  // A rota só exige `view`: abrir contagem pede `create` em inventory, como o botão "Nova contagem" da lista.
  const canCreate = usePermission("create", "inventory");
  if (id === "nova") {
    return (
      <div className="space-y-6">
        <BackLink />
        <PageHeader title="Nova contagem de inventário" description={canCreate ? "Escolha o local a contar." : undefined} />
        {canCreate ? (
          <NewCountForm companyId={session.company.id} userId={session.user.id} />
        ) : (
          <EmptyState
            icon={ClipboardCheck}
            title="Sem permissão para abrir contagem"
            description="Seu perfil consulta o estoque, mas não abre contagem de inventário. Peça a quem cuida do estoque."
          />
        )}
      </div>
    );
  }
  return <CountSheet countId={id} />;
}

function BackLink() {
  return (
    <Link to="/inventory/inventarios" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground print:hidden">
      <ArrowLeft size={14} /> Inventário
    </Link>
  );
}

function CountSheet({ countId }: { countId: string }) {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const invalidate = useInvalidateInventory(companyId);
  const canEdit = usePermission("edit", "inventory");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("todos");
  const [search, setSearch] = useState("");
  const [newItemId, setNewItemId] = useState("");

  const { data: detail, isLoading, refetch } = useQuery({
    queryKey: inventoryKeys.count(companyId, countId),
    queryFn: async () => loadInventoryCount(await getDb(), companyId, countId),
  });
  const { data: snapshot } = useQuery({
    queryKey: inventoryKeys.snapshot(companyId),
    queryFn: async () => loadStockSnapshot(await getDb(), companyId),
    enabled: Boolean(detail && detail.count.status === "aberta"),
  });

  const count = detail?.count;
  const lines = detail?.items ?? [];
  const open = count?.status === "aberta";
  const editable = open && canEdit;
  const label = count ? formatSequence("inventory_counts", count.number) : "";
  /** Saldo do sistema que vale para o ajuste: o de agora (aberta) ou o gravado na conclusão. */
  const systemQty = (line: InventoryCountLine) => (open ? line.current_qty : Number(line.expected_qty));
  const difference = (line: InventoryCountLine) => (line.counted_qty == null ? null : roundQty(Number(line.counted_qty) - systemQty(line)));

  /** Grava uma linha; o rascunho do campo só some depois de a contagem ser relida (sem piscar o valor antigo). */
  async function withSaving(lineId: string, task: () => Promise<unknown>, clearDraft?: () => void) {
    setSaving((current) => new Set(current).add(lineId));
    setError(null);
    try {
      await task();
      await refetch();
      clearDraft?.();
      invalidate();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setSaving((current) => {
        const next = new Set(current);
        next.delete(lineId);
        return next;
      });
    }
  }

  function commitCount(line: InventoryCountLine) {
    const draft = drafts[line.id];
    if (draft === undefined) return;
    const trimmed = draft.trim();
    const value = trimmed === "" ? null : parseDecimal(trimmed);
    const current = line.counted_qty == null ? null : Number(line.counted_qty);
    if (value === current) {
      setDrafts(({ [line.id]: _omit, ...rest }) => rest);
      return;
    }
    void withSaving(
      line.id,
      async () => setCountedQuantity(await getDb(), { companyId, countItemId: line.id, countedQty: value }),
      () => setDrafts(({ [line.id]: _omit, ...rest }) => rest),
    );
  }

  function commitNote(line: InventoryCountLine) {
    const draft = noteDrafts[line.id];
    if (draft === undefined || draft.trim() === (line.notes ?? "")) return;
    void withSaving(
      line.id,
      async () => setCountedQuantity(await getDb(), { companyId, countItemId: line.id, countedQty: line.counted_qty == null ? null : Number(line.counted_qty), notes: draft }),
      () => setNoteDrafts(({ [line.id]: _omit, ...rest }) => rest),
    );
  }

  function onCountKey(event: KeyboardEvent<HTMLInputElement>, index: number) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    // Enter grava e vai para o próximo item (contagem rápida pelo teclado).
    const next = document.getElementById(`count-qty-${index + 1}`);
    if (next) next.focus();
    else event.currentTarget.blur();
  }

  const finish = useMutation({
    mutationFn: async () => {
      const result = await finishInventoryCount(await getDb(), { companyId, countId, userId: session.user.id });
      await emit({
        type: "stock.count_finished",
        companyId,
        actorId: session.user.id,
        entityType: "inventory_count",
        entityId: countId,
        title: `Contagem ${label} concluída: ${result.movementIds.length} ${result.movementIds.length === 1 ? "ajuste" : "ajustes"} em ${count?.location_name ?? "local"}`,
        module: "inventory",
      });
    },
    onSuccess: () => invalidate(),
    onError: (caught) => {
      invalidate();
      setError(errorText(caught));
    },
  });

  const cancel = useMutation({
    mutationFn: async () => {
      await cancelInventoryCount(await getDb(), { companyId, countId });
      await emit({ type: "stock.count_cancelled", companyId, actorId: session.user.id, entityType: "inventory_count", entityId: countId, title: `Contagem ${label} cancelada`, module: "inventory" });
    },
    onSuccess: () => invalidate(),
    onError: (caught) => setError(errorText(caught)),
  });

  const addItem = useMutation({
    mutationFn: async () => {
      await addCountItem(await getDb(), { companyId, countId, itemId: newItemId });
    },
    onSuccess: () => {
      setNewItemId("");
      invalidate();
    },
    onError: (caught) => setError(errorText(caught)),
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <BackLink />
        <PageHeader title="Contagem de inventário" description="Carregando a contagem..." />
        <TableSkeleton rows={6} />
      </div>
    );
  }
  if (!count) {
    return (
      <div className="space-y-6">
        <BackLink />
        <PageHeader title="Contagem de inventário" />
        <EmptyState icon={ClipboardCheck} title="Contagem não encontrada" description="Ela pode ter sido removida, ou o link está incompleto." />
      </div>
    );
  }

  const counted = lines.filter((line) => line.counted_qty != null);
  const pending = lines.length - counted.length;
  const divergent = counted.filter((line) => difference(line) !== 0);
  const missingUnits = divergent.reduce((sum, line) => sum + Math.min(0, difference(line) ?? 0), 0);
  const extraUnits = divergent.reduce((sum, line) => sum + Math.max(0, difference(line) ?? 0), 0);
  const differenceValue = sumMoney(divergent.map((line) => {
    const diff = difference(line) ?? 0;
    return (diff < 0 ? -1 : 1) * lineTotal(Math.abs(diff), line.cost);
  }));
  const query = normalizeSearch(search);
  const shown = lines.filter((line) => {
    if (view === "pendentes" && line.counted_qty != null) return false;
    if (view === "divergentes" && !(line.counted_qty != null && difference(line) !== 0)) return false;
    return !query || [line.item_name, line.sku].some((value) => normalizeSearch(value ?? "").includes(query));
  });
  const inCount = new Set(lines.map((line) => line.item_id));
  const addable = (snapshot?.items ?? []).filter((item) => !inCount.has(item.id));

  function confirmFinish() {
    const summary =
      divergent.length === 0
        ? "Nenhum item tem diferença: o estoque não muda."
        : `${divergent.length} ${divergent.length === 1 ? "item tem" : "itens têm"} diferença (falta de ${formatQty(Math.abs(missingUnits))}, sobra de ${formatQty(extraUnits)}). O estoque de ${count?.location_name ?? "local"} será ajustado.`;
    if (window.confirm(`Concluir a contagem ${label}?\n\n${summary}\n\nDepois de concluída ela não pode ser alterada.`)) finish.mutate();
  }

  return (
    <div className="space-y-6">
      <BackLink />
      <PageHeader
        title={`Contagem ${label}`}
        description={`${count.location_name ?? "Sem local"} · iniciada em ${formatDateTime(count.started_at)}${count.counted_by_name ? ` por ${count.counted_by_name}` : ""}${count.finished_at ? ` · concluída em ${formatDateTime(count.finished_at)}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <StatusBadge status={count.status} />
            <button type="button" onClick={() => window.print()} className={BUTTON_OUTLINE}>
              <Printer size={14} /> Imprimir folha
            </button>
            {editable && (
              <>
                <button type="button" onClick={() => { if (window.confirm(`Cancelar a contagem ${label}? O estoque não muda.`)) cancel.mutate(); }} disabled={cancel.isPending || finish.isPending} className={BUTTON_OUTLINE}>
                  <XCircle size={14} /> Cancelar contagem
                </button>
                <button type="button" onClick={confirmFinish} disabled={pending > 0 || lines.length === 0 || finish.isPending || saving.size > 0} title={pending > 0 ? (pending === 1 ? "Falta 1 item sem contagem" : `Faltam ${pending} itens sem contagem`) : undefined} className={BUTTON_PRIMARY}>
                  {finish.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Concluir e ajustar estoque
                </button>
              </>
            )}
          </div>
        }
      />
      {count.notes && <p className="-mt-4 text-sm text-muted-foreground">{count.notes}</p>}

      <ErrorBanner message={error} onClose={() => setError(null)} />
      {editable && pending > 0 && (
        <p className="text-sm text-muted-foreground print:hidden">
          Faltam <strong className="text-foreground">{pending}</strong> {pending === 1 ? "item" : "itens"} sem contagem. Digite a quantidade encontrada (0 se não achou) e tecle Enter para ir ao próximo; a conclusão ajusta pelo saldo do momento.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 print:hidden">
        <StatCard title="Itens" value={lines.length} />
        <StatCard title="Contados" value={`${counted.length}/${lines.length}`} kind="text" />
        <StatCard title="Com diferença" value={divergent.length} hint={divergent.length ? `Falta ${formatQty(Math.abs(missingUnits))} · sobra ${formatQty(extraUnits)}` : undefined} />
        <StatCard title="Valor da diferença" value={formatCurrency(differenceValue)} kind="text" hint="Pelo custo do item (negativo = perda)" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4 print:hidden">
        <div role="group" aria-label="Mostrar" className="flex gap-1">
          {([
            ["todos", "Todos"],
            ["pendentes", `Sem contagem (${pending})`],
            ["divergentes", `Com diferença (${divergent.length})`],
          ] as const).map(([value, text]) => (
            <button key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)} className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${view === value ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {text}
            </button>
          ))}
        </div>
        <label className="flex w-64 items-center rounded-md border bg-background px-3 py-1.5 text-sm">
          <span className="sr-only">Buscar item</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar item ou SKU..." className="w-full bg-transparent outline-none placeholder:text-muted-foreground" />
        </label>
      </div>

      {lines.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="Nenhum item nesta contagem" description={editable ? "Adicione os itens que vão ser contados neste local." : undefined} />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="whitespace-nowrap bg-muted/30">
              <tr>
                <th className="min-w-[12rem] px-4 py-3 text-left font-medium text-muted-foreground">Item</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">{open ? "Saldo no sistema" : "Saldo do sistema"}</th>
                <th className="w-36 px-4 py-3 text-left font-medium text-muted-foreground">Contado</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Diferença</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Observação</th>
                {!open && <th className="px-4 py-3 text-left font-medium text-muted-foreground">Ajuste</th>}
                {editable && <th className="w-12 px-4 py-3 print:hidden" />}
              </tr>
            </thead>
            <tbody className="divide-y">
              {shown.map((line, index) => {
                const diff = difference(line);
                const draft = drafts[line.id];
                const busy = saving.has(line.id);
                const snapshotDiffers = open && roundQty(Number(line.expected_qty)) !== line.current_qty;
                return (
                  <tr key={line.id} className="align-top">
                    <td className="px-4 py-3">
                      <p className="font-medium">{line.item_name}</p>
                      <p className="text-xs text-muted-foreground">{[line.sku, line.unit].filter(Boolean).join(" · ")}</p>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatQty(systemQty(line), line.unit)}
                      {snapshotDiffers && (
                        <p className="whitespace-nowrap text-xs text-muted-foreground" title="O saldo mudou depois que a contagem foi aberta (entrada, saída ou transferência). O ajuste usa o saldo do momento da conclusão.">
                          na abertura: {formatQty(Number(line.expected_qty))}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {editable ? (
                        <div className="flex items-center gap-2">
                          <label className="sr-only" htmlFor={`count-qty-${index}`}>Quantidade contada de {line.item_name}</label>
                          <input
                            id={`count-qty-${index}`}
                            value={draft ?? (line.counted_qty == null ? "" : String(line.counted_qty).replace(".", ","))}
                            onChange={(event) => setDrafts((current) => ({ ...current, [line.id]: event.target.value }))}
                            onBlur={() => commitCount(line)}
                            onKeyDown={(event) => onCountKey(event, index)}
                            inputMode="decimal"
                            placeholder="—"
                            className={`${INPUT} text-right tabular-nums`}
                          />
                          {busy && <Loader2 size={14} className="shrink-0 animate-spin text-muted-foreground" aria-label="Gravando" />}
                        </div>
                      ) : (
                        <span className="tabular-nums">{line.counted_qty == null ? "—" : formatQty(Number(line.counted_qty), line.unit)}</span>
                      )}
                    </td>
                    <td className={`px-4 py-3 text-right font-medium tabular-nums ${diff == null || diff === 0 ? "text-muted-foreground" : diff < 0 ? "text-status-danger" : "text-emerald-700 dark:text-emerald-400"}`}>
                      {diff == null ? "—" : signed(diff, line.unit)}
                    </td>
                    <td className="px-4 py-3">
                      {editable ? (
                        <>
                          <label className="sr-only" htmlFor={`count-note-${line.id}`}>Observação de {line.item_name}</label>
                          <input
                            id={`count-note-${line.id}`}
                            value={noteDrafts[line.id] ?? line.notes ?? ""}
                            onChange={(event) => setNoteDrafts((current) => ({ ...current, [line.id]: event.target.value }))}
                            onBlur={() => commitNote(line)}
                            placeholder="Opcional"
                            className={INPUT}
                          />
                        </>
                      ) : (
                        <span className="text-muted-foreground">{line.notes ?? "—"}</span>
                      )}
                    </td>
                    {!open && (
                      <td className="px-4 py-3 text-muted-foreground">
                        {line.adjustment_movement_id ? (
                          <Link to={`/inventory/movimentacoes?item=${encodeURIComponent(line.item_id)}`} className="text-primary-text hover:underline">Ajustado</Link>
                        ) : count.status === "concluida" ? "Sem diferença" : "—"}
                      </td>
                    )}
                    {editable && (
                      <td className="px-4 py-3 text-right print:hidden">
                        <button
                          type="button"
                          onClick={() => void withSaving(line.id, async () => removeCountItem(await getDb(), { companyId, countItemId: line.id }))}
                          aria-label={`Retirar ${line.item_name} da contagem`}
                          title="Retirar da contagem"
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {shown.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">Nenhum item neste filtro.</p>}
        </div>
      )}

      {editable && (
        <div className="flex flex-wrap items-end gap-2 print:hidden">
          <label className="space-y-1.5 text-sm font-medium" htmlFor="count-add-item">
            Incluir item na contagem
            <select id="count-add-item" value={newItemId} onChange={(event) => setNewItemId(event.target.value)} className={`${INPUT} w-72`}>
              <option value="">{addable.length === 0 ? "Todos os itens já estão na contagem" : "Escolha o item"}</option>
              {addable.map((item) => <option key={item.id} value={item.id}>{item.sku ? `${item.name} (${item.sku})` : item.name}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => addItem.mutate()} disabled={!newItemId || addItem.isPending} className={BUTTON_OUTLINE}>
            <Plus size={14} /> Incluir
          </button>
        </div>
      )}
    </div>
  );
}
