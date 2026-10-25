import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Bookmark, Trash2 } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { deleteSavedView, saveView } from "@/lib/crm/segments";
import { cn } from "@/lib/utils";
import type { SavedView } from "@/types";
import { BTN_GHOST, INPUT, SELECT } from "./ui";
import { errorText } from "./Modal";
import { useCrmSession, useInvalidateCrm, useSavedViews } from "./useCrm";

interface SavedViewsBarProps {
  /** saved_views.entity_type: "customer", "opportunity"... */
  entityType: string;
  /** Filtros atuais da lista (vão para filters_json). */
  current: object;
  /** Há algum filtro ativo (sem filtro não há o que salvar). */
  hasFilters: boolean;
  onApply: (view: SavedView | null) => void;
  /** Pode compartilhar o segmento com a empresa (gerência). */
  canShare: boolean;
}

/** Segmentos salvos de uma lista: aplicar, salvar o filtro atual com um nome e excluir os próprios. */
export function SavedViewsBar({ entityType, current, hasFilters, onApply, canShare }: SavedViewsBarProps) {
  const { companyId, userId } = useCrmSession();
  const invalidate = useInvalidateCrm();
  const { data: views = [] } = useSavedViews(entityType);
  const [selected, setSelected] = useState("");
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const selectedView = views.find((view) => view.id === selected) ?? null;

  const save = useMutation({
    mutationFn: async () => saveView(await getDb(), companyId, shared ? null : userId, entityType, name, current),
    onSuccess: (id) => {
      invalidate("views");
      setSelected(id);
      setNaming(false);
      setName("");
      setShared(false);
    },
  });
  const remove = useMutation({
    mutationFn: async (id: string) => deleteSavedView(await getDb(), companyId, id),
    onSuccess: () => {
      invalidate("views");
      setSelected("");
      onApply(null);
    },
  });
  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
      <label className="flex min-w-0 max-w-full items-center gap-1.5 text-sm text-muted-foreground">
        <Bookmark size={14} aria-hidden="true" className="shrink-0" />
        <select
          value={selected}
          onChange={(event) => {
            setSelected(event.target.value);
            onApply(views.find((view) => view.id === event.target.value) ?? null);
          }}
          aria-label="Segmento salvo"
          className={cn(SELECT, "min-w-0 max-w-full")}
        >
          <option value="">Segmentos salvos…</option>
          {views.map((view) => (
            <option key={view.id} value={view.id}>
              {view.name}
              {view.user_id ? "" : " (empresa)"}
            </option>
          ))}
        </select>
      </label>
      {selectedView && (selectedView.user_id === userId || (!selectedView.user_id && canShare)) && (
        <button type="button" onClick={() => remove.mutate(selectedView.id)} disabled={remove.isPending} className={BTN_GHOST} aria-label={`Excluir o segmento ${selectedView.name}`}>
          <Trash2 size={12} /> Excluir
        </button>
      )}
      {!naming && hasFilters && (
        <button type="button" onClick={() => setNaming(true)} className={BTN_GHOST}>
          Salvar filtro
        </button>
      )}
      {naming && (
        <form
          className="flex flex-wrap items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome do segmento" aria-label="Nome do segmento" className={cn(INPUT, "h-8 w-44")} autoFocus />
          {canShare && (
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <input type="checkbox" checked={shared} onChange={(event) => setShared(event.target.checked)} /> Para a empresa
            </label>
          )}
          <button type="submit" disabled={!name.trim() || save.isPending} className={BTN_GHOST}>Salvar</button>
          <button type="button" onClick={() => setNaming(false)} className={BTN_GHOST}>Cancelar</button>
          {save.error && <span role="alert" className="text-xs text-destructive">{errorText(save.error)}</span>}
        </form>
      )}
    </div>
  );
}
