import type { ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton, TABLE_ICONS } from "./table";
import { useModalFocus } from "./useModalFocus";

interface DetailDrawerProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  onEdit?: () => void;
  children: ReactNode;
}

export function DetailDrawer({ title, subtitle, onClose, onEdit, children }: DetailDrawerProps) {
  const panel = useModalFocus<HTMLElement>(onClose);
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/60" onClick={onClose}>
      <aside ref={panel} role="dialog" aria-modal="true" aria-label={title} className="h-full w-full max-w-xl overflow-y-auto border-l bg-card p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b pb-5">
          <div>
            {subtitle && <p className="text-xs font-medium text-muted-foreground">{subtitle}</p>}
            <h2 className="mt-1 text-xl font-semibold">{title}</h2>
          </div>
          <div className="flex gap-1">
            {onEdit && <IconButton label="Editar" icon={TABLE_ICONS.edit} onClick={onEdit} />}
            <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-md p-2 text-muted-foreground hover:bg-muted"><X size={17} /></button>
          </div>
        </div>
        <div className="py-5">{children}</div>
      </aside>
    </div>
  );
}

export function DetailGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

export function DetailItem({ label, value }: { label: string; value: ReactNode }) {
  return <div><p className="text-xs font-medium text-muted-foreground">{label}</p><div className="mt-1 text-sm">{value || "—"}</div></div>;
}
