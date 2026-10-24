// Classes repetidas nas telas do CRM (tokens do tema; nada de cor solta).
export const INPUT = "h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring";
export const SELECT = "h-9 rounded-md border bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring";
export const TEXTAREA = "w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
export const BTN_PRIMARY =
  "inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50";
export const BTN_SECONDARY =
  "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";
export const BTN_DANGER =
  "inline-flex items-center gap-1.5 rounded-md border border-destructive/40 px-3 py-1.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50";
export const BTN_GHOST = "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50";
export const CARD = "rounded-xl border bg-card";
export const TH = "whitespace-nowrap px-4 py-3 text-left font-medium text-muted-foreground";
export const TD = "px-4 py-3";
export const LINK = "font-medium text-primary-text hover:underline";

/** Cor sólida das tags (mesmos tons do StatusBadge). */
export const TONE_CLASS = {
  danger: "bg-status-danger text-white",
  success: "bg-status-success text-white",
  warning: "bg-status-warning text-status-warning-ink",
  orange: "bg-status-orange text-white",
  info: "bg-status-info text-white",
  violet: "bg-status-violet text-white",
  neutral: "bg-status-neutral text-white",
} as const;
