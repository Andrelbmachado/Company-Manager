import type { ReactNode } from "react";
import { X } from "lucide-react";
import { useModalFocus } from "@/components/shared/useModalFocus";
import { cn } from "@/lib/utils";
import { BTN_DANGER, BTN_PRIMARY, BTN_SECONDARY } from "./ui";

interface ModalProps {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "md" | "lg" | "xl";
}

/** Modal acessível (foco preso, Esc fecha) para formulários que não cabem no CrudDialog. */
export function Modal({ title, description, onClose, children, footer, size = "md" }: ModalProps) {
  const panel = useModalFocus<HTMLDivElement>(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn("flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl border bg-card shadow-2xl", size === "md" ? "max-w-lg" : size === "lg" ? "max-w-2xl" : "max-w-5xl")}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
          <div>
            <h2 className="font-semibold">{title}</h2>
            {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

/** Confirmação dentro do app (o confirm() nativo não é confiável no webview do desktop). */
export function ConfirmDialog({ title, message, confirmLabel, danger, busy, error, onConfirm, onClose }: ConfirmDialogProps) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={BTN_SECONDARY}>Cancelar</button>
          <button type="button" onClick={onConfirm} disabled={busy} className={danger ? BTN_DANGER : BTN_PRIMARY}>{confirmLabel}</button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <div>{message}</div>
        {error && <p role="alert" className="text-destructive">{error}</p>}
      </div>
    </Modal>
  );
}

/** Mensagem de erro de uma mutação (Error.message ou texto). */
export function errorText(error: unknown): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : String(error);
}
