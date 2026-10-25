// Folha de uma contagem de inventário. Aberta: tabela editável (Editar = contado e observação de cada item; Adicionar =
// incluir item com o contado). Concluir só com a tabela fora do modo edição (nada de rascunho esquecido). Concluída ou
// cancelada: tabela só de leitura com o ajuste de cada item.
import { useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, ClipboardCheck, Loader2, Printer, Trash2, XCircle } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { usePermission } from "@/hooks/usePermission";
import { useRequiredSession } from "@/hooks/useSession";
import { confirmAction } from "@/lib/confirm";
import { getDb } from "@/lib/db/client";
import { formatSequence } from "@/lib/db/sequence";
import { saveCountLineRows } from "@/lib/inventory/countRows";
import { cancelInventoryCount, finishInventoryCount, loadInventoryCount, removeCountItem, type InventoryCountLine } from "@/lib/inventory/counts";
import { assertCan } from "@/lib/inventory/permission";
import { loadStockSnapshot } from "@/lib/inventory/queries";
import { formatQty, roundQty } from "@/lib/inventory/stock";
import { lineTotal, sumMoney } from "@/lib/money";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { BUTTON_OUTLINE, BUTTON_PRIMARY, emitSafely, ErrorBanner, errorText, inventoryKeys, normalizeSearch, TableSkeleton, useActor, useInvalidateInventory } from "../components/inventoryUi";

type View = "todos" | "pendentes" | "divergentes";

function signed(value: number, unit?: string): string {
  if (value === 0) return formatQty(0, unit);
  return `${value > 0 ? "+" : "−"}${formatQty(Math.abs(value), unit)}`;
}

export interface CountSheetRow {
  id: string;
  item_id: string;
  item_name: string;
  sku: string | null;
  unit: string;
  /** Saldo que vale para o ajuste: o de agora (aberta) ou o gravado na conclusão. */
  system_qty: number;
  expected_qty: number;
  counted_qty: number | null;
  difference: number | null;
  notes: string | null;
  adjustment_movement_id: string | null;
}

export default function InventoryCountPage() {
  const { id = "" } = useParams();
  // Rota antiga do formulário "Nova contagem": abrir contagem agora é Adicionar na tabela da lista.
  if (id === "nova") return <Navigate to="/inventory/inventarios" replace />;
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
  const actor = useActor();
  const invalidate = useInvalidateInventory(companyId);
  const canEdit = usePermission("edit", "inventory");
  const sheet = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("todos");
  const [search, setSearch] = useState("");

  const detailQuery = useQuery({
    queryKey: inventoryKeys.count(companyId, countId),
    queryFn: async () => loadInventoryCount(await getDb(), companyId, countId),
  });
  const detail = detailQuery.data;
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
  const systemQty = (line: InventoryCountLine) => (open ? line.current_qty : Number(line.expected_qty));
  const difference = (line: InventoryCountLine) => (line.counted_qty == null ? null : roundQty(Number(line.counted_qty) - systemQty(line)));

  const finish = useMutation({
    mutationFn: async () => {
      assertCan(actor, "edit", "inventory", "contagens de inventário");
      const result = await finishInventoryCount(await getDb(), { companyId, countId, userId: actor.userId });
      await emitSafely([
        {
          type: "stock.count_finished",
          companyId,
          actorId: actor.userId,
          entityType: "inventory_count",
          entityId: countId,
          title: `Contagem ${label} concluída: ${result.movementIds.length} ${result.movementIds.length === 1 ? "ajuste" : "ajustes"} em ${count?.location_name ?? "local"}`,
          module: "inventory",
        },
      ]);
    },
    onSuccess: () => invalidate(),
    onError: (caught) => {
      invalidate();
      setError(errorText(caught));
    },
  });

  const cancel = useMutation({
    mutationFn: async () => {
      assertCan(actor, "edit", "inventory", "contagens de inventário");
      await cancelInventoryCount(await getDb(), { companyId, countId });
      await emitSafely([{ type: "stock.count_cancelled", companyId, actorId: actor.userId, entityType: "inventory_count", entityId: countId, title: `Contagem ${label} cancelada`, module: "inventory" }]);
    },
    onSuccess: () => invalidate(),
    onError: (caught) => setError(errorText(caught)),
  });

  if (detailQuery.isLoading) {
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
  const differenceValue = sumMoney(
    divergent.map((line) => {
      const diff = difference(line) ?? 0;
      return (diff < 0 ? -1 : 1) * lineTotal(Math.abs(diff), line.cost);
    }),
  );
  const query = normalizeSearch(search);
  const shown = lines.filter((line) => {
    if (view === "pendentes" && line.counted_qty != null) return false;
    if (view === "divergentes" && !(line.counted_qty != null && difference(line) !== 0)) return false;
    return !query || [line.item_name, line.sku].some((value) => normalizeSearch(value ?? "").includes(query));
  });
  const rows: CountSheetRow[] = shown.map((line) => ({
    id: line.id,
    item_id: line.item_id,
    item_name: line.item_name,
    sku: line.sku,
    unit: line.unit,
    system_qty: systemQty(line),
    expected_qty: Number(line.expected_qty),
    counted_qty: line.counted_qty == null ? null : Number(line.counted_qty),
    difference: difference(line),
    notes: line.notes ?? null,
    adjustment_movement_id: line.adjustment_movement_id ?? null,
  }));
  const inCount = new Set(lines.map((line) => line.item_id));
  const itemOptions = [
    ...lines.map((line) => ({ value: line.item_id, label: line.sku ? `${line.item_name} (${line.sku})` : line.item_name })),
    ...(snapshot?.items ?? []).filter((item) => !inCount.has(item.id)).map((item) => ({ value: item.id, label: item.sku ? `${item.name} (${item.sku})` : item.name })),
  ];

  const diffClass = (diff: number | null) => (diff == null || diff === 0 ? "text-muted-foreground" : diff < 0 ? "text-status-danger dark:text-red-400" : "text-emerald-700 dark:text-emerald-400");
  const columns: EditableColumn<CountSheetRow>[] = [
    {
      key: "item_id",
      header: "Item",
      kind: "select",
      required: true,
      options: itemOptions,
      render: (row) => (
        <span>
          <span className="block font-medium">{row.item_name}</span>
          <span className="block text-xs text-muted-foreground">{[row.sku, row.unit].filter(Boolean).join(" · ")}</span>
        </span>
      ),
    },
    {
      key: "system_qty",
      header: open ? "Saldo no sistema" : "Saldo do sistema",
      kind: "number",
      readOnly: true,
      render: (row) => (
        <span>
          {formatQty(row.system_qty, row.unit)}
          {open && roundQty(row.expected_qty) !== row.system_qty && (
            <span className="block whitespace-nowrap text-xs text-muted-foreground" title="O saldo mudou depois que a contagem foi aberta. O ajuste usa o saldo do momento da conclusão.">
              na abertura: {formatQty(row.expected_qty)}
            </span>
          )}
        </span>
      ),
    },
    { key: "counted_qty", header: "Contado", kind: "number", placeholder: "—", render: (row) => (row.counted_qty == null ? "—" : formatQty(row.counted_qty, row.unit)) },
    { key: "difference", header: "Diferença", kind: "number", readOnly: true, render: (row) => <span className={`font-medium ${diffClass(row.difference)}`}>{row.difference == null ? "—" : signed(row.difference, row.unit)}</span> },
    { key: "notes", header: "Observação", kind: "text", placeholder: "Opcional" },
  ];

  async function save(changes: EditableTableChanges<CountSheetRow>) {
    const pick = (row: Partial<CountSheetRow>) => ({
      ...("item_id" in row ? { item_id: row.item_id ?? null } : {}),
      ...("counted_qty" in row ? { counted_qty: row.counted_qty ?? null } : {}),
      ...("notes" in row ? { notes: row.notes ?? null } : {}),
    });
    await saveCountLineRows(await getDb(), companyId, actor, countId, {
      updated: changes.updated.map((row) => ({ ...pick(row), id: row.id })),
      created: changes.created.map((row) => ({ ...pick(row), id: row.id })),
    });
    invalidate();
  }

  async function removeLine(row: CountSheetRow) {
    setError(null);
    try {
      assertCan(actor, "edit", "inventory", "contagens de inventário");
      await removeCountItem(await getDb(), { companyId, countItemId: row.id });
      invalidate();
    } catch (caught) {
      setError(errorText(caught));
    }
  }

  async function confirmFinish() {
    if (sheet.current?.querySelector("[data-editing]")) {
      setError("Salve ou cancele as alterações da tabela antes de concluir a contagem.");
      return;
    }
    const summary =
      divergent.length === 0
        ? "Nenhum item tem diferença: o estoque não muda."
        : `${divergent.length} ${divergent.length === 1 ? "item tem" : "itens têm"} diferença (falta de ${formatQty(Math.abs(missingUnits))}, sobra de ${formatQty(extraUnits)}). O estoque de ${count?.location_name ?? "local"} será ajustado.`;
    if (await confirmAction(`Concluir a contagem ${label}?\n\n${summary}\n\nDepois de concluída ela não pode ser alterada.`, { title: "Concluir contagem", okLabel: "Concluir e ajustar" })) finish.mutate();
  }

  return (
    <div className="space-y-6" ref={sheet}>
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
                <button
                  type="button"
                  onClick={async () => {
                    if (await confirmAction(`Cancelar a contagem ${label}? O estoque não muda.`, { title: "Cancelar contagem", okLabel: "Cancelar contagem", cancelLabel: "Voltar" })) cancel.mutate();
                  }}
                  disabled={cancel.isPending || finish.isPending}
                  className={BUTTON_OUTLINE}
                >
                  <XCircle size={14} /> Cancelar contagem
                </button>
                <button
                  type="button"
                  onClick={() => void confirmFinish()}
                  disabled={pending > 0 || lines.length === 0 || finish.isPending}
                  title={pending > 0 ? (pending === 1 ? "Falta 1 item sem contagem" : `Faltam ${pending} itens sem contagem`) : undefined}
                  className={BUTTON_PRIMARY}
                >
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
          Faltam <strong className="text-foreground">{pending}</strong> {pending === 1 ? "item" : "itens"} sem contagem. Use Editar, digite a quantidade encontrada (0 se não achou) e salve; a conclusão ajusta pelo saldo do momento.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 print:hidden">
        <StatCard title="Itens" value={lines.length} />
        <StatCard title="Contados" value={`${counted.length}/${lines.length}`} />
        <StatCard title="Com diferença" value={divergent.length} />
        <StatCard title="Valor da diferença" value={formatCurrency(differenceValue)} />
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

      {open ? (
        <EditableTable
          resource="inventory"
          label={`Itens da contagem ${label}`}
          title="Itens da contagem"
          rows={rows}
          columns={columns}
          loading={detailQuery.isFetching && !detail}
          onSave={save}
          onRefresh={() => detailQuery.refetch()}
          newRow={() => ({ id: uuidv4(), item_id: "", counted_qty: null })}
          emptyMessage={lines.length === 0 ? "Nenhum item nesta contagem. Use Adicionar para incluir os itens a contar." : "Nenhum item neste filtro."}
          rowActions={
            editable
              ? (row) => (
                  <button type="button" onClick={() => void removeLine(row)} aria-label={`Retirar ${row.item_name} da contagem`} title="Retirar da contagem" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted print:hidden">
                    <Trash2 size={15} />
                  </button>
                )
              : undefined
          }
        />
      ) : (
        <ClosedSheet rows={rows} concluded={count.status === "concluida"} diffClass={diffClass} />
      )}
    </div>
  );
}

/** Contagem concluída ou cancelada: não muda mais, então a folha é só leitura. */
function ClosedSheet({ rows, concluded, diffClass }: { rows: CountSheetRow[]; concluded: boolean; diffClass: (diff: number | null) => string }) {
  if (rows.length === 0) return <EmptyState icon={ClipboardCheck} title="Nenhum item nesta contagem" />;
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-sm" aria-label="Itens da contagem">
        <thead className="whitespace-nowrap bg-muted/30">
          <tr>
            <th className="min-w-[12rem] px-4 py-3 text-left font-medium text-muted-foreground">Item</th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground">Saldo do sistema</th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground">Contado</th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground">Diferença</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Observação</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Ajuste</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={row.id} className="align-top">
              <td className="px-4 py-3">
                <p className="font-medium">{row.item_name}</p>
                <p className="text-xs text-muted-foreground">{[row.sku, row.unit].filter(Boolean).join(" · ")}</p>
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{formatQty(row.system_qty, row.unit)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{row.counted_qty == null ? "—" : formatQty(row.counted_qty, row.unit)}</td>
              <td className={`px-4 py-3 text-right font-medium tabular-nums ${diffClass(row.difference)}`}>{row.difference == null ? "—" : signed(row.difference, row.unit)}</td>
              <td className="px-4 py-3 text-muted-foreground">{row.notes ?? "—"}</td>
              <td className="px-4 py-3 text-muted-foreground">
                {row.adjustment_movement_id ? (
                  <Link to={`/inventory/movimentacoes?item=${encodeURIComponent(row.item_id)}`} className="text-primary-text hover:underline">Ajustado</Link>
                ) : concluded ? "Sem diferença" : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
