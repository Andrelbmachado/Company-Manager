// Lançamento manual de estoque: entrada, saída (consumo, perda, doação) ou ajuste de falta/sobra num local.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CrudDialog } from "@/components/shared/CrudDialog";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import type { StockItemRow } from "@/lib/inventory/queries";
import { formatQty, recordStockMovement, roundQty } from "@/lib/inventory/stock";
import type { StockLocation, StockMovementType } from "@/types";
import { ErrorBanner, errorText, parseDecimal } from "./inventoryUi";

export type ManualMovementKind = "entrada" | "saida" | "ajuste_falta" | "ajuste_sobra";

const KIND_OPTIONS: { value: ManualMovementKind; label: string }[] = [
  { value: "entrada", label: "Entrada (compra avulsa, devolução, saldo inicial)" },
  { value: "saida", label: "Saída (consumo, perda, doação)" },
  { value: "ajuste_falta", label: "Ajuste: falta no local" },
  { value: "ajuste_sobra", label: "Ajuste: sobra no local" },
];

/** Tipo gravado e sentido (o local é a origem quando sai). */
function movementOf(kind: ManualMovementKind): { type: StockMovementType; leaves: boolean } {
  if (kind === "entrada") return { type: "entrada", leaves: false };
  if (kind === "saida") return { type: "saida", leaves: true };
  return { type: "ajuste", leaves: kind === "ajuste_falta" };
}

interface StockMovementDialogProps {
  companyId: string;
  userId: string;
  items: readonly StockItemRow[];
  locations: readonly StockLocation[];
  initial?: { kind?: ManualMovementKind; itemId?: string; locationId?: string };
  onClose: () => void;
  onSaved: () => void;
}

export function StockMovementDialog({ companyId, userId, items, locations, initial, onClose, onSaved }: StockMovementDialogProps) {
  const [values, setValues] = useState<Record<string, string>>({
    kind: initial?.kind ?? "entrada",
    item_id: initial?.itemId ?? "",
    location_id: initial?.locationId ?? locations[0]?.id ?? "",
    quantity: "",
    unit_cost: "",
    note: "",
  });
  const [error, setError] = useState<string | null>(null);
  const kind = values.kind as ManualMovementKind;
  const { type, leaves } = movementOf(kind);
  const item = items.find((row) => row.id === values.item_id);
  const location = locations.find((row) => row.id === values.location_id);
  const available = item && location ? item.byLocation[location.id] ?? 0 : 0;
  const quantity = parseDecimal(values.quantity);

  const save = useMutation({
    mutationFn: async () => {
      if (!item) throw new Error("Escolha o item.");
      if (!location) throw new Error("Escolha o local.");
      const unitCost = type === "entrada" ? parseDecimal(values.unit_cost) : Number.NaN;
      const db = await getDb();
      const id = await recordStockMovement(db, {
        companyId,
        itemId: item.id,
        type,
        quantity,
        fromLocationId: leaves ? location.id : null,
        toLocationId: leaves ? null : location.id,
        unitCost: Number.isFinite(unitCost) ? unitCost : null,
        refType: "manual",
        userId,
        note: values.note,
      });
      await emit({
        type: "stock.movement_created",
        companyId,
        actorId: userId,
        entityType: "stock_movement",
        entityId: id,
        title: `${KIND_OPTIONS.find((option) => option.value === kind)?.label.split(" (")[0]}: ${formatQty(quantity, item.unit)} de ${item.name} (${location.name})`,
        module: "inventory",
        newValue: { type, item_id: item.id, location_id: location.id, quantity, note: values.note || null },
      });
    },
    onSuccess: () => onSaved(),
    onError: (caught) => setError(errorText(caught)),
  });

  const fields = [
    { key: "kind", label: "Tipo", type: "select" as const, options: KIND_OPTIONS },
    {
      key: "item_id",
      label: "Item",
      type: "select" as const,
      required: true,
      options: [{ value: "", label: "Escolha o item" }, ...items.map((row) => ({ value: row.id, label: row.sku ? `${row.name} (${row.sku})` : row.name }))],
    },
    { key: "location_id", label: "Local", type: "select" as const, required: true, options: locations.map((row) => ({ value: row.id, label: row.name })) },
    { key: "quantity", label: `Quantidade${item ? ` (${item.unit})` : ""}`, placeholder: "0", required: true },
    ...(type === "entrada" ? [{ key: "unit_cost", label: "Custo unitário (R$)", placeholder: item ? String(item.cost).replace(".", ",") : "0,00" }] : []),
    { key: "note", label: "Observação", type: "textarea" as const, placeholder: leaves ? "Motivo da saída (ex.: consumo na OS 123, avaria)" : "Origem da entrada" },
  ];

  const after = Number.isFinite(quantity) ? roundQty(available + (leaves ? -quantity : quantity)) : null;

  return (
    <CrudDialog
      title="Movimentar estoque"
      fields={fields}
      values={values}
      onChange={(key, value) => {
        setError(null);
        setValues((current) => ({ ...current, [key]: value }));
      }}
      onClose={onClose}
      onSubmit={() => {
        setError(null);
        save.mutate();
      }}
      busy={save.isPending}
      submitLabel="Gravar movimentação"
    >
      <div className="mt-4 space-y-3">
        {item && location && (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            Saldo em {location.name}: <strong className="text-foreground">{formatQty(available, item.unit)}</strong>
            {after !== null && quantity > 0 && (
              <>
                {" "}→ depois: <strong className={after < 0 ? "text-destructive" : "text-foreground"}>{formatQty(after, item.unit)}</strong>
              </>
            )}
          </p>
        )}
        {locations.length === 0 && <ErrorBanner message="Cadastre um local de estoque antes de movimentar (Estoque › Locais)." />}
        <ErrorBanner message={error} />
      </div>
    </CrudDialog>
  );
}
