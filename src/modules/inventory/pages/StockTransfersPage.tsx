// Transferências na tabela editável: cada linha é um item enviado de um local para outro. Adicionar lança (linhas novas
// com a mesma origem, destino e observação viram uma transferência só; o saldo da origem é conferido antes de gravar:
// nenhum local fica negativo). Editar muda só a observação.
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { v4 as uuidv4 } from "uuid";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { useRequiredSession } from "@/hooks/useSession";
import { getDb } from "@/lib/db/client";
import { saveTransferRows, toTransferTableRows, type TransferInputRow, type TransferTableRow } from "@/lib/inventory/movementRows";
import { listStockMovements, loadStockSnapshot } from "@/lib/inventory/queries";
import { formatQty } from "@/lib/inventory/stock";
import { formatDateTime } from "@/lib/utils";
import { emitSafely, inventoryKeys, normalizeSearch, useActor, useInvalidateInventory } from "../components/inventoryUi";

export default function StockTransfersPage() {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const actor = useActor();
  const invalidate = useInvalidateInventory(companyId);
  const [params] = useSearchParams();
  const presetItem = params.get("item");
  const [search, setSearch] = useState("");

  const { data: snapshot } = useQuery({
    queryKey: inventoryKeys.snapshot(companyId),
    queryFn: async () => loadStockSnapshot(await getDb(), companyId),
  });
  const movementsQuery = useQuery({
    queryKey: inventoryKeys.movements(companyId),
    queryFn: async () => listStockMovements(await getDb(), companyId),
  });
  const items = useMemo(() => snapshot?.items ?? [], [snapshot]);
  const locations = useMemo(() => snapshot?.locations ?? [], [snapshot]);
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const transfers = toTransferTableRows(movementsQuery.data ?? []);
  const query = normalizeSearch(search);
  const visible = transfers.filter((row) => !query || [row.from_name, row.to_name, row.note, row.user_name, row.item_name, row.sku].some((value) => normalizeSearch(value ?? "").includes(query)));
  const transferCount = new Set(transfers.map((row) => row.transfer_id)).size;

  /** Linha nova: com o item escolhido pela ficha, a origem é o local onde ele tem mais saldo. */
  function newRow(): Partial<TransferTableRow> {
    const preset = presetItem ? itemById.get(presetItem) : undefined;
    const best = preset ? Object.entries(preset.byLocation).sort((a, b) => b[1] - a[1])[0]?.[0] : undefined;
    const origin = best && locations.some((location) => location.id === best) ? best : locations[0]?.id ?? "";
    return { id: uuidv4(), item_id: preset?.id ?? "", from_location_id: origin, to_location_id: locations.find((location) => location.id !== origin)?.id ?? "" };
  }

  const locationOptions = locations.map((location) => ({ value: location.id, label: location.name }));
  const columns: EditableColumn<TransferTableRow>[] = [
    { key: "created_at", header: "Data", kind: "text", readOnly: true, render: (row) => <span className="whitespace-nowrap text-muted-foreground">{row.created_at ? formatDateTime(row.created_at) : "—"}</span> },
    { key: "from_location_id", header: "De (origem)", kind: "select", required: true, options: locationOptions, render: (row) => row.from_name ?? "—" },
    { key: "to_location_id", header: "Para (destino)", kind: "select", required: true, options: locationOptions, render: (row) => row.to_name ?? "—" },
    {
      key: "item_id",
      header: "Item",
      kind: "select",
      required: true,
      options: items.map((item) => ({ value: item.id, label: item.sku ? `${item.name} (${item.sku})` : item.name })),
      render: (row) => (
        <span>
          <span className="block font-medium">{row.item_name}</span>
          {row.sku && <span className="block text-xs text-muted-foreground">{row.sku}</span>}
        </span>
      ),
    },
    { key: "quantity", header: "Quantidade", kind: "number", required: true, render: (row) => <span className="whitespace-nowrap">{formatQty(row.quantity, row.item_unit)}</span> },
    { key: "note", header: "Observação", kind: "text", placeholder: "Motivo (ex.: reposição da loja)" },
    { key: "user_name", header: "Responsável", kind: "text", readOnly: true },
  ];

  async function save(changes: EditableTableChanges<TransferTableRow>) {
    const pick = (row: Partial<TransferTableRow>) => {
      const picked: Record<string, unknown> = {};
      for (const key of ["from_location_id", "to_location_id", "item_id", "quantity", "note"] as const) if (key in row) picked[key] = row[key] ?? null;
      return picked as Partial<TransferInputRow>;
    };
    const result = await saveTransferRows(await getDb(), companyId, actor, {
      updated: changes.updated.map((row) => ({ ...pick(row), id: row.id })),
      created: changes.created.map((row) => ({ ...pick(row), id: row.id })),
    });
    invalidate();
    const names = new Map(locations.map((location) => [location.id, location.name]));
    await emitSafely(
      result.transfers.map((transfer) => ({
        type: "stock.transfer",
        companyId,
        actorId: actor.userId,
        entityType: "stock_transfer",
        entityId: transfer.id,
        title: `Transferência de ${transfer.lines} ${transfer.lines === 1 ? "item" : "itens"}: ${names.get(transfer.from_location_id) ?? ""} → ${names.get(transfer.to_location_id) ?? ""}`,
        module: "inventory",
      })),
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Transferências" description="Envio de itens entre locais de estoque. O saldo da origem é conferido na hora: nenhum local fica negativo." />
      {locations.length < 2 && snapshot && <p className="rounded-lg border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">Para transferir, cadastre pelo menos dois locais em Estoque › Locais.</p>}
      {presetItem && itemById.get(presetItem) && (
        <p className="text-sm text-muted-foreground">
          Use Adicionar para transferir <strong className="text-foreground">{itemById.get(presetItem)!.name}</strong>: a linha nova já vem com o item e a origem onde ele tem mais saldo.
        </p>
      )}

      <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar por local, item ou observação...">
        <span className="text-sm text-muted-foreground">{transferCount} {transferCount === 1 ? "transferência" : "transferências"}</span>
      </PageToolbar>

      <EditableTable
        resource="inventory"
        label="Transferências entre locais"
        title="Itens transferidos"
        rows={visible}
        columns={columns}
        loading={movementsQuery.isLoading}
        onSave={save}
        onRefresh={() => movementsQuery.refetch()}
        newRow={newRow}
        emptyMessage={transfers.length === 0 ? "Nenhuma transferência ainda." : "Nenhuma transferência encontrada."}
      />
      <p className="text-xs text-muted-foreground">Linhas novas com a mesma origem, destino e observação viram uma transferência só. Transferência gravada não muda (em Editar só a observação é gravada): para desfazer, transfira de volta.</p>
    </div>
  );
}
