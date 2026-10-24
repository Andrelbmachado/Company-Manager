// Formatação e links das telas do CRM.
import type { CrmEntityType } from "@/types";

const DECIMAL = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Número → texto de campo de valor ("1.234,50"); vazio para null. parseMoneyInput lê de volta. */
export function moneyInput(value: number | null | undefined): string {
  return value == null || !Number.isFinite(Number(value)) ? "" : DECIMAL.format(Number(value));
}

const pad = (value: number) => String(value).padStart(2, "0");

/** Instante ISO → valor de <input type="datetime-local"> no fuso local. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Valor de <input type="datetime-local"> (hora local) → instante ISO (UTC); vazio → null. */
export function fromLocalInput(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Data/hora curta no fuso local ("24/10/2026 14:30"). */
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(iso) || iso.length <= 10 ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Dia local ('YYYY-MM-DD') de um instante: ISO com fuso (nowIso) ou datetime('now') do SQLite, que é UTC sem fuso.
 * Data pura passa direto. Evita o `.slice(0, 10)`, que dá o dia UTC (21h de 31/10 em Brasília já seria novembro).
 */
export function localDay(value: string | null | undefined): string {
  if (!value) return "";
  if (value.length <= 10) return value;
  const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 'YYYY-MM-DD' daqui a `days` dias (dia local). */
export function daysFromToday(days: number, now = new Date()): string {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const ENTITY_LABELS: Record<CrmEntityType, string> = {
  customer: "Cliente",
  contact: "Contato",
  lead: "Lead",
  opportunity: "Oportunidade",
  proposal: "Proposta",
};

/** Endereço da tela de um registro do CRM (null quando não há tela própria). */
export function entityHref(type: CrmEntityType | string, id: string, customerId?: string | null): string | null {
  switch (type) {
    case "customer":
      return `/crm/clientes/${id}`;
    case "opportunity":
      return `/crm/funil?oportunidade=${encodeURIComponent(id)}`;
    case "proposal":
      return `/crm/propostas/${id}`;
    case "lead":
      return "/leads";
    case "contact":
      return customerId ? `/crm/clientes/${customerId}?aba=contatos` : "/crm/contatos";
    default:
      return null;
  }
}

/** Iniciais para o avatar do responsável. */
export function initialsOf(name: string | null | undefined): string {
  return (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}
