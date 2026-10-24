// Abrir uma contagem de inventário num local (usado na lista de inventários e em /inventory/inventarios/nova).
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { formatSequence } from "@/lib/db/sequence";
import { emit } from "@/lib/events/bus";
import { openInventoryCount } from "@/lib/inventory/counts";
import { listLocationSummaries } from "@/lib/inventory/locations";
import { BUTTON_OUTLINE, BUTTON_PRIMARY, ErrorBanner, errorText, Field, INPUT, inventoryKeys, useInvalidateInventory } from "./inventoryUi";

interface NewCountFormProps {
  companyId: string;
  userId: string;
  onCancel?: () => void;
}

export function NewCountForm({ companyId, userId, onCancel }: NewCountFormProps) {
  const navigate = useNavigate();
  const invalidate = useInvalidateInventory(companyId);
  const [locationId, setLocationId] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { data: locations = [], isLoading } = useQuery({
    queryKey: inventoryKeys.locations(companyId),
    queryFn: async () => listLocationSummaries(await getDb(), companyId),
  });

  useEffect(() => {
    if (!locationId) setLocationId(locations.find((location) => !location.open_count_id)?.id ?? "");
  }, [locations, locationId]);
  const selected = locations.find((location) => location.id === locationId);

  const open = useMutation({
    mutationFn: async () => {
      const { id, number } = await openInventoryCount(await getDb(), { companyId, locationId, userId, notes });
      await emit({
        type: "stock.count_opened",
        companyId,
        actorId: userId,
        entityType: "inventory_count",
        entityId: id,
        title: `Contagem ${formatSequence("inventory_counts", number)} aberta em ${selected?.name ?? "local"}`,
        module: "inventory",
      });
      return id;
    },
    onSuccess: (id) => {
      invalidate();
      navigate(`/inventory/inventarios/${id}`);
    },
    onError: (caught) => setError(errorText(caught)),
  });

  return (
    <section className="space-y-4 rounded-xl border bg-card p-5" aria-labelledby="new-count-title">
      <div className="flex items-center gap-2">
        <ClipboardList size={18} className="text-muted-foreground" aria-hidden="true" />
        <h2 id="new-count-title" className="font-semibold">Nova contagem</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        A contagem entra com todos os itens que têm saldo no local e o saldo do sistema de cada um. Depois de contar, conclua para ajustar o estoque (falta sai, sobra entra).
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Local"
          htmlFor="new-count-location"
          hint={selected ? `${selected.item_count} ${selected.item_count === 1 ? "item" : "itens"} com saldo neste local` : undefined}
        >
          <select id="new-count-location" value={locationId} onChange={(event) => { setError(null); setLocationId(event.target.value); }} className={INPUT} disabled={isLoading}>
            <option value="">{locations.length === 0 ? "Cadastre um local em Estoque › Locais" : "Escolha o local"}</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id} disabled={Boolean(location.open_count_id)}>
                {location.name}
                {location.open_count_number ? ` (contagem ${formatSequence("inventory_counts", location.open_count_number)} aberta)` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Observação" htmlFor="new-count-notes">
          <input id="new-count-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Ex.: contagem mensal das prateleiras" className={INPUT} />
        </Field>
      </div>
      <ErrorBanner message={error} onClose={() => setError(null)} />
      <div className="flex justify-end gap-2">
        {onCancel && <button type="button" onClick={onCancel} className={BUTTON_OUTLINE}>Cancelar</button>}
        <button type="button" onClick={() => { setError(null); open.mutate(); }} disabled={!locationId || open.isPending} className={BUTTON_PRIMARY}>
          Abrir contagem
        </button>
      </div>
    </section>
  );
}
