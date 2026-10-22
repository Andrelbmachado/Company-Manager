import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

export function formatDate(date: string | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("pt-BR").format(new Date(date));
}

export function formatDateTime(date: string | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(date));
}

export function initials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}

/**
 * "YYYY-MM-DD" → "dd/mm/aaaa" sem passar por Date (evita deslocar o dia por fuso).
 * Timestamp (com horário) é um instante: mostra o dia no fuso local; horário sem fuso (datetime('now') do SQLite) é UTC.
 */
export function formatDay(date: string | null | undefined): string {
  if (!date) return "—";
  if (date.length > 10 && /\d{2}:\d{2}/.test(date)) {
    const instant = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(date) ? date : `${date.replace(" ", "T")}Z`);
    if (!Number.isNaN(instant.getTime())) return `${String(instant.getDate()).padStart(2, "0")}/${String(instant.getMonth() + 1).padStart(2, "0")}/${instant.getFullYear()}`;
  }
  const [year, month, day] = date.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : date;
}

/** Hoje como "YYYY-MM-DD" no fuso local. */
export function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
