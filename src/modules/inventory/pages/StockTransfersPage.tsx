import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, ArrowRightLeft, CheckCircle2, Plus, Trash2 } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { useRequiredSession } from "@/hooks/useSession";
import { usePermission } from "@/hooks/usePermission";
import { emit } from "@/lib/events/bus";
import { groupTransfers, listStockMovements, loadStockSnapshot } from "@/lib/inventory/queries";
import { formatQty, roundQty, transferStock } from "@/lib/inventory/stock";
import { formatDateTime } from "@/lib/utils";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { BUTTON_OUTLINE, BUTTON_PRIMARY, ErrorBanner, errorText, Field, INPUT, inventoryKeys, normalizeSearch, parseDecimal, TableSkeleton, useInvalidateInventory } from "../components/inventoryUi";

interface Line {
  key: number;
  itemId: string;
  qty: string;
}

let lineKey = 0;
const newLine = (itemId = ""): Line => ({ key: ++lineKey, itemId, qty: "" });

export default function StockTransfersPage() {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const invalidate = useInvalidateInventory(companyId);
  const canTransfer = usePermission("transfer", "inventory");
  const [params, setParams] = useSearchParams();
  const presetItem = params.get("item");
  const [showForm, setShowForm] = useState(Boolean(presetItem));
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine(presetItem ?? "")]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const { data: snapshot } = useQuery({
    queryKey: inventoryKeys.snapshot(companyId),
    queryFn: async () => loadStockSnapshot(await getDb(), companyId),
  });
  const { data: movements = [], isLoading } = useQuery({
    queryKey: inventoryKeys.movements(companyId),
    queryFn: async () => listStockMovements(await getDb(), companyId),
  });
  const items = useMemo(() => snapshot?.items ?? [], [snapshot]);
  const locations = useMemo(() => snapshot?.locations ?? [], [snapshot]);
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  // Origem e destino padrão: com um item escolhido pela ficha, o local onde ele tem mais saldo.
  useEffect(() => {
    if (!snapshot || fromId) return;
    const preset = presetItem ? itemById.get(presetItem) : undefined;
    const best = preset ? Object.entries(preset.byLocation).sort((a, b) => b[1] - a[1])[0]?.[0] : undefined;
    const origin = best && locations.some((location) => location.id === best) ? best : locations[0]?.id ?? "";
    setFromId(origin);
    setToId(locations.find((location) => location.id !== origin)?.id ?? "");
  }, [snapshot, fromId, presetItem, itemById, locations]);

  const available = (itemId: string) => roundQty(itemById.get(itemId)?.byLocation[fromId] ?? 0);
  const requested = new Map<string, number>();
  for (const line of lines) {
    const qty = parseDecimal(line.qty);
    if (line.itemId && Number.isFinite(qty)) requested.set(line.itemId, roundQty((requested.get(line.itemId) ?? 0) + qty));
  }
  const lineProblem = (line: Line): string | null => {
    if (!line.itemId) return null;
    const qty = parseDecimal(line.qty);
    if (!line.qty.trim()) return null;
    if (!Number.isFinite(qty) || qty <= 0) return "Quantidade inválida";
    if ((requested.get(line.itemId) ?? 0) > available(line.itemId)) return `Disponível: ${formatQty(available(line.itemId), itemById.get(line.itemId)?.unit)}`;
    return null;
  };
  const filledLines = lines.filter((line) => line.itemId && line.qty.trim());
  const ready = Boolean(fromId && toId && fromId !== toId && filledLines.length > 0 && filledLines.every((line) => !lineProblem(line)));
  const originItems = items.filter((item) => (item.byLocation[fromId] ?? 0) > 0);

  const transfer = useMutation({
    mutationFn: async () => {
      const db = await getDb();
      const result = await transferStock(db, {
        companyId,
        fromLocationId: fromId,
        toLocationId: toId,
        lines: filledLines.map((line) => ({ itemId: line.itemId, quantity: parseDecimal(line.qty) })),
        userId: session.user.id,
        note,
      });
      const from = locations.find((location) => location.id === fromId)?.name ?? "";
      const to = locations.find((location) => location.id === toId)?.name ?? "";
      await emit({
        type: "stock.transfer",
        companyId,
        actorId: session.user.id,
        entityType: "stock_transfer",
        entityId: result.transferId,
        title: `Transferência de ${result.movementIds.length} ${result.movementIds.length === 1 ? "item" : "itens"}: ${from} → ${to}`,
        module: "inventory",
        newValue: { from_location_id: fromId, to_location_id: toId, lines: filledLines.map((line) => ({ item_id: line.itemId, quantity: parseDecimal(line.qty) })), note: note || null },
      });
      return `Transferência gravada: ${result.movementIds.length} ${result.movementIds.length === 1 ? "item" : "itens"} de ${from} para ${to}.`;
    },
    onSuccess: (message) => {
      invalidate();
      setDone(message);
      setLines([newLine()]);
      setNote("");
      setShowForm(false);
      if (presetItem) setParams({}, { replace: true });
    },
    onError: (caught) => setError(errorText(caught)),
  });

  const transfers = groupTransfers(movements);
  const query = normalizeSearch(search);
  const visibleTransfers = transfers.filter(
    (row) => !query || [row.from_name, row.to_name, row.note, row.user_name, ...row.lines.map((line) => line.item_name)].some((value) => normalizeSearch(value ?? "").includes(query)),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transferências"
        description="Envio de itens entre locais de estoque. O saldo da origem é conferido na hora: nenhum local fica negativo."
        actions={
          canTransfer && !showForm && locations.length > 1 ? (
            <button type="button" onClick={() => { setDone(null); setShowForm(true); }} className={BUTTON_PRIMARY}>
              <Plus size={14} /> Nova transferência
            </button>
          ) : undefined
        }
      />

      {done && (
        <div role="status" className="flex items-center gap-2 rounded-lg border border-status-success/40 bg-status-success/10 px-4 py-3 text-sm">
          <CheckCircle2 size={16} className="text-status-success" aria-hidden="true" /> {done}
        </div>
      )}
      {canTransfer && locations.length < 2 && snapshot && (
        <p className="rounded-lg border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">Para transferir, cadastre pelo menos dois locais em Estoque › Locais.</p>
      )}

      {showForm && canTransfer && (
        <section className="space-y-4 rounded-xl border bg-card p-5" aria-labelledby="transfer-form-title">
          <h2 id="transfer-form-title" className="font-semibold">Nova transferência</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="De (origem)" htmlFor="transfer-from">
              <select id="transfer-from" value={fromId} onChange={(event) => { setError(null); setFromId(event.target.value); }} className={INPUT}>
                {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
              </select>
            </Field>
            <Field label="Para (destino)" htmlFor="transfer-to" hint={fromId && fromId === toId ? "A origem e o destino precisam ser locais diferentes." : undefined}>
              <select id="transfer-to" value={toId} onChange={(event) => { setError(null); setToId(event.target.value); }} className={INPUT}>
                <option value="">Escolha o destino</option>
                {locations.map((location) => <option key={location.id} value={location.id} disabled={location.id === fromId}>{location.name}</option>)}
              </select>
            </Field>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="whitespace-nowrap bg-muted/30">
                <tr>
                  <th className="min-w-[12rem] px-3 py-2 text-left font-medium text-muted-foreground">Item</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Disponível na origem</th>
                  <th className="w-40 px-3 py-2 text-left font-medium text-muted-foreground">Quantidade</th>
                  <th className="w-12 px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {lines.map((line, index) => {
                  const problem = lineProblem(line);
                  const options = originItems.some((item) => item.id === line.itemId) || !line.itemId ? originItems : [...originItems, ...(itemById.get(line.itemId) ? [itemById.get(line.itemId)!] : [])];
                  return (
                    <tr key={line.key}>
                      <td className="px-3 py-2">
                        <label className="sr-only" htmlFor={`transfer-item-${line.key}`}>Item da linha {index + 1}</label>
                        <select
                          id={`transfer-item-${line.key}`}
                          value={line.itemId}
                          onChange={(event) => setLines((current) => current.map((row) => (row.key === line.key ? { ...row, itemId: event.target.value } : row)))}
                          className={INPUT}
                        >
                          <option value="">{originItems.length === 0 ? "Nenhum item com saldo na origem" : "Escolha o item"}</option>
                          {options.map((item) => <option key={item.id} value={item.id}>{item.sku ? `${item.name} (${item.sku})` : item.name}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{line.itemId ? formatQty(available(line.itemId), itemById.get(line.itemId)?.unit) : "—"}</td>
                      <td className="px-3 py-2">
                        <label className="sr-only" htmlFor={`transfer-qty-${line.key}`}>Quantidade da linha {index + 1}</label>
                        <input
                          id={`transfer-qty-${line.key}`}
                          value={line.qty}
                          inputMode="decimal"
                          placeholder="0"
                          aria-invalid={Boolean(problem)}
                          aria-describedby={problem ? `transfer-problem-${line.key}` : undefined}
                          onChange={(event) => setLines((current) => current.map((row) => (row.key === line.key ? { ...row, qty: event.target.value } : row)))}
                          className={`${INPUT} ${problem ? "border-destructive" : ""}`}
                        />
                        {problem && <p id={`transfer-problem-${line.key}`} className="mt-1 text-xs text-destructive">{problem}</p>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {lines.length > 1 && (
                          <button type="button" onClick={() => setLines((current) => current.filter((row) => row.key !== line.key))} aria-label={`Remover linha ${index + 1}`} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted">
                            <Trash2 size={15} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button type="button" onClick={() => setLines((current) => [...current, newLine()])} className={BUTTON_OUTLINE}>
            <Plus size={14} /> Adicionar item
          </button>

          <Field label="Observação" htmlFor="transfer-note">
            <textarea id="transfer-note" value={note} onChange={(event) => setNote(event.target.value)} rows={2} placeholder="Motivo da transferência (ex.: reposição da loja)" className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
          </Field>

          <ErrorBanner message={error} onClose={() => setError(null)} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setShowForm(false); setError(null); }} className={BUTTON_OUTLINE}>Cancelar</button>
            <button type="button" onClick={() => { setError(null); transfer.mutate(); }} disabled={!ready || transfer.isPending} className={BUTTON_PRIMARY}>
              <ArrowRightLeft size={14} /> Transferir
            </button>
          </div>
        </section>
      )}

      <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar por local, item ou observação...">
        <span className="text-sm text-muted-foreground">{visibleTransfers.length} {visibleTransfers.length === 1 ? "transferência" : "transferências"}</span>
      </PageToolbar>

      {isLoading ? (
        <TableSkeleton />
      ) : visibleTransfers.length === 0 ? (
        <EmptyState icon={ArrowRightLeft} title={transfers.length === 0 ? "Nenhuma transferência ainda" : "Nenhuma transferência encontrada"} />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="whitespace-nowrap bg-muted/30">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Data</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">De → Para</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Itens</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Responsável</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Observação</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {visibleTransfers.map((row) => (
                <tr key={row.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDateTime(row.created_at)}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 font-medium">
                      {row.from_name ?? "—"} <ArrowRight size={12} aria-label="para" /> {row.to_name ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <ul className="space-y-0.5">
                      {row.lines.map((line) => (
                        <li key={line.movement_id}>
                          <span className="tabular-nums">{formatQty(line.quantity, line.unit)}</span> · {line.item_name}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{row.user_name ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{row.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
