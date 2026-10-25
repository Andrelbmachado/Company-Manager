// Peças pequenas repetidas nas telas de RH (botões, cabeçalho de tabela, aviso de erro, link de volta).
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export const BTN_PRIMARY = "inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50";
export const BTN_SECONDARY = "inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";
export const BTN_SMALL = "inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";
export const TH = "whitespace-nowrap px-4 py-3 text-left font-medium text-muted-foreground";
export const INPUT = "flex h-9 w-full rounded-md border bg-background px-3 text-sm font-normal outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

/** Cor do saldo de horas: negativo em vermelho, positivo em verde. */
export const balanceTone = (minutes: number) => (minutes < 0 ? "text-status-danger dark:text-red-400" : minutes > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground");

export const errorMessage = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** Aviso de erro de uma ação (fecha no botão). */
export function ErrorAlert({ message, onClose }: { message: string; onClose?: () => void }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-status-danger bg-card px-4 py-2.5 text-sm">
      <span><strong className="text-status-danger dark:text-red-400">Não foi possível concluir. </strong>{message}</span>
      {onClose && <button type="button" onClick={onClose} className="shrink-0 font-medium underline">fechar</button>}
    </p>
  );
}

/** Erro dentro de um diálogo. */
export function DialogError({ message }: { message: string }) {
  return message ? <p role="alert" className="mt-3 text-sm font-medium text-status-danger dark:text-red-400">{message}</p> : null;
}

/** Aviso de sucesso discreto (ex.: "Ficha salva"). */
export function Notice({ children }: { children: ReactNode }) {
  return <p role="status" className="rounded-lg border bg-card px-4 py-2.5 text-sm text-emerald-700 dark:text-emerald-400">{children}</p>;
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
      <ArrowLeft size={14} aria-hidden="true" /> {children}
    </Link>
  );
}

/** Cartão com título (seções das telas de RH). */
export function Panel({ title, actions, children, className }: { title: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border bg-card ${className ?? ""}`} aria-label={title}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
        <h2 className="font-bold">{title}</h2>
        {actions}
      </header>
      {children}
    </section>
  );
}
