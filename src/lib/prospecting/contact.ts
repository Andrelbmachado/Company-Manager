import type { LeadPresenceKind, LeadStatus } from "@/types";

export const LEAD_STATUSES: { value: LeadStatus; label: string }[] = [
  { value: "novo", label: "Novo" },
  { value: "abordado", label: "Abordado" },
  { value: "interessado", label: "Interessado" },
  { value: "fechado", label: "Fechado" },
];

export const PRESENCE_LABELS: Record<LeadPresenceKind, string> = {
  site_quebrado: "Site quebrado",
  redes_agendamento: "Só redes / agendamento",
  nenhuma: "Sem presença própria",
};

/** Link wa.me a partir de "(15) 99999-9999" (assume Brasil, DDI 55). */
export function whatsappUrl(phone: string | null | undefined, text?: string): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  const base = `https://wa.me/${digits.startsWith("55") && digits.length > 11 ? digits : `55${digits}`}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

export function telUrl(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? `tel:+55${digits}` : null;
}

/** "4,8 ★ (100)" ou "—" quando o lead não tem avaliações. */
export function formatRating(rating: number | null | undefined, reviews: number | null | undefined): string {
  if (rating == null && reviews == null) return "—";
  const stars = rating == null ? "" : `${rating.toFixed(1).replace(".", ",")} ★ `;
  return `${stars}${reviews == null ? "" : `(${reviews})`}`.trim();
}

/** Data ISO "2026-10-23" → "23/10/2026" sem passar por Date (evita deslocamento de fuso). */
export function formatIsoDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [year, month, day] = iso.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : iso;
}

const moneyFormat = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** R$ 1.200 (sem centavos) — valores de pacote e previsão são estimativas, centavos só confundem. */
export function formatMoney(value: number): string {
  return moneyFormat.format(value);
}

/** Abre URL no navegador do sistema (Tauri) ou em nova aba (navegador). */
export async function openExternal(url: string): Promise<void> {
  if ("__TAURI_INTERNALS__" in window) {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
