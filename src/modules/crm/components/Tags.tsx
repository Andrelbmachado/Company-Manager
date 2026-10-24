import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { addTag, createTag, removeTag, TAG_COLORS } from "@/lib/crm/segments";
import { cn } from "@/lib/utils";
import type { BadgeTone, Tag } from "@/types";
import { BTN_GHOST, INPUT, SELECT, TONE_CLASS } from "./ui";
import { errorText } from "./Modal";
import { useCrmSession, useInvalidateCrm, useTags } from "./useCrm";

export function TagChip({ tag, onRemove, className }: { tag: Pick<Tag, "name" | "color">; onRemove?: () => void; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold", TONE_CLASS[tag.color] ?? TONE_CLASS.neutral, className)}>
      {tag.name}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Tirar a tag ${tag.name}`} className="-mr-1 rounded p-0.5 opacity-80 hover:opacity-100">
          <X size={11} />
        </button>
      )}
    </span>
  );
}

/** Tags de um registro: lista e, com permissão, marca/desmarca e cria tags novas. */
export function TagEditor({ entityType, entityId, canEdit }: { entityType: string; entityId: string; canEdit: boolean }) {
  const { companyId, userId } = useCrmSession();
  const invalidate = useInvalidateCrm();
  const { tags, byEntity, byId } = useTags(entityType);
  const [adding, setAdding] = useState(false);
  const [choice, setChoice] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState<BadgeTone>("info");
  const current = (byEntity.get(entityId) ?? []).map((id) => byId.get(id)).filter((tag): tag is Tag => !!tag);
  const available = tags.filter((tag) => !current.some((item) => item.id === tag.id));

  const add = useMutation({
    mutationFn: async () => {
      const db = await getDb();
      const tagId = choice === "__new" || available.length === 0 ? await createTag(db, companyId, name, color, entityType) : choice;
      if (!tagId) throw new Error("Escolha uma tag.");
      await addTag(db, companyId, tagId, entityType, entityId, userId);
    },
    onSuccess: () => {
      invalidate("tags");
      setAdding(false);
      setChoice("");
      setName("");
    },
  });
  const remove = useMutation({
    mutationFn: async (tagId: string) => removeTag(await getDb(), companyId, tagId, entityType, entityId),
    onSuccess: () => invalidate("tags"),
  });

  const creating = choice === "__new" || available.length === 0;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {current.map((tag) => <TagChip key={tag.id} tag={tag} onRemove={canEdit ? () => remove.mutate(tag.id) : undefined} />)}
      {current.length === 0 && !adding && <span className="text-xs text-muted-foreground">Sem tags</span>}
      {canEdit && !adding && (
        <button type="button" onClick={() => setAdding(true)} className={BTN_GHOST}>
          <Plus size={12} /> Tag
        </button>
      )}
      {canEdit && adding && (
        <form
          className="flex flex-wrap items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            add.mutate();
          }}
        >
          {available.length > 0 && (
            <select value={choice} onChange={(event) => setChoice(event.target.value)} aria-label="Tag" className={cn(SELECT, "h-8")}>
              <option value="">Escolha a tag…</option>
              {available.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
              <option value="__new">+ Nova tag</option>
            </select>
          )}
          {creating && (
            <>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome da tag" aria-label="Nome da nova tag" className={cn(INPUT, "h-8 w-36")} autoFocus />
              <select value={color} onChange={(event) => setColor(event.target.value as BadgeTone)} aria-label="Cor da tag" className={cn(SELECT, "h-8")}>
                {TAG_COLORS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </>
          )}
          <button type="submit" disabled={add.isPending || (creating ? !name.trim() : !choice)} className={BTN_GHOST}>Adicionar</button>
          <button type="button" onClick={() => { setAdding(false); add.reset(); }} className={BTN_GHOST}>Cancelar</button>
          {add.error && <span role="alert" className="text-xs text-destructive">{errorText(add.error)}</span>}
        </form>
      )}
    </div>
  );
}
