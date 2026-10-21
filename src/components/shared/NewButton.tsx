import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { usePermission } from "@/hooks/usePermission";
import { getEntity, newLabel, type EntityKey } from "@/lib/data/entities";

/** Primary "Novo X" button, hidden when the role cannot create the entity. */
export function NewButton({ entity, onClick, label }: { entity: EntityKey; onClick: () => void; label?: string }) {
  const def = getEntity(entity);
  const allowed = usePermission("create", def.resource);
  if (!allowed || def.creatable === false) return null;
  return (
    <Button variant="primary" onClick={onClick} data-testid={`new-${entity}`}>
      <Plus size={14} />
      {label ?? newLabel(def)}
    </Button>
  );
}
