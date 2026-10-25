// Peças comuns das telas de estoque: chaves de consulta, mensagens de erro, selo do tipo de movimentação e campos.
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, X } from "lucide-react";
import { useRequiredSession } from "@/hooks/useSession";
import { emit, type DomainEvent } from "@/lib/events/bus";
import { PermissionError, type Actor } from "@/lib/inventory/permission";
import { roundQty, StockError } from "@/lib/inventory/stock";
import { MOVEMENT_TYPE_LABELS } from "@/lib/inventory/queries";
import { roundMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { Role, StockMovementType } from "@/types";

/** Todas as consultas do estoque começam com ["inventory", companyId]: invalidar o prefixo atualiza todas as telas. */
export const inventoryKeys = {
  all: (companyId: string) => ["inventory", companyId] as const,
  snapshot: (companyId: string) => ["inventory", companyId, "snapshot"] as const,
  movements: (companyId: string) => ["inventory", companyId, "movements"] as const,
  counts: (companyId: string) => ["inventory", companyId, "counts"] as const,
  count: (companyId: string, countId: string) => ["inventory", companyId, "count", countId] as const,
  reorder: (companyId: string) => ["inventory", companyId, "reorder"] as const,
  locations: (companyId: string) => ["inventory", companyId, "locations"] as const,
  custodies: (companyId: string) => ["inventory-custodies", companyId] as const,
};

/** Depois de mexer no estoque: telas do estoque, opções de item da custódia e indicadores do dashboard. */
export function useInvalidateInventory(companyId: string): (options?: { purchases?: boolean }) => void {
  const qc = useQueryClient();
  return (options) => {
    void qc.invalidateQueries({ queryKey: inventoryKeys.all(companyId) });
    void qc.invalidateQueries({ queryKey: ["inventory-options", companyId] });
    void qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
    if (options?.purchases) {
      // Pedidos de compra gerados pela reposição aparecem em Compras (chaves daquele módulo).
      void qc.invalidateQueries({ predicate: (query) => /purchas/i.test(String(query.queryKey[0])) });
    }
  };
}

/** Quem está gravando (papel e conta), para a permissão conferida na camada de dados. */
export function useActor(): Actor {
  const session = useRequiredSession();
  return { role: session.membership.role as Role, userId: session.user.id };
}

/** Evento de histórico depois de gravar: falha no evento não desfaz nem esconde a gravação (só vai para o console). */
export async function emitSafely(events: readonly DomainEvent[]): Promise<void> {
  for (const event of events) {
    try {
      await emit(event);
    } catch (caught) {
      console.error(`[logística] evento ${event.type} falhou`, caught);
    }
  }
}

/** Mensagem para a tela: a da regra de estoque ou um aviso genérico com o detalhe técnico. */
export function errorText(error: unknown): string {
  if (error instanceof StockError || error instanceof PermissionError) return error.message;
  const detail = error instanceof Error ? error.message : String(error ?? "");
  return detail ? `Não foi possível concluir: ${detail}` : "Não foi possível concluir a operação.";
}

/**
 * Número digitado em pt-BR, no mesmo formato que a tela mostra (formatQty): "2,5", "1.234,5" e "1.250" (= mil duzentos
 * e cinquenta, ponto de milhar). Ponto que não é de milhar vale como decimal ("2.5", "0.125"), e "1,234.56" também é
 * aceito. Ignora "R$" e espaços. Vazio ou texto que não é número ("1O,50", "2,5 kg") → NaN.
 */
export function parseDecimal(text: string): number {
  let value = text.replace(/R\$/gi, "").replace(/\s+/g, "");
  let sign = 1;
  if (value.startsWith("-") || value.startsWith("+")) {
    if (value.startsWith("-")) sign = -1;
    value = value.slice(1);
  }
  if (!value) return Number.NaN;
  let normalized: string;
  if (/^\d{1,3}(,\d{3})+\.\d+$/.test(value)) {
    // "1,234.56": vírgula de milhar e ponto decimal.
    normalized = value.replace(/,/g, "");
  } else if (value.includes(",")) {
    // Vírgula decimal (uma só); pontos antes dela só como milhar ("1.234,5").
    const parts = value.split(",");
    if (parts.length !== 2 || (parts[0] && !/^(\d+|\d{1,3}(\.\d{3})+)$/.test(parts[0]))) return Number.NaN;
    normalized = `${parts[0].replace(/\./g, "")}.${parts[1]}`;
  } else if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(value)) {
    // "1.250" e "1.234.567": ponto de milhar, como a tela mostra.
    normalized = value.replace(/\./g, "");
  } else {
    normalized = value;
  }
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(normalized)) return Number.NaN;
  return sign * Number(normalized);
}

export interface ItemNumberFields {
  min_stock: string;
  max_stock: string;
  cost: string;
  initial_qty?: string;
}

/**
 * Números do cadastro de item lidos do formulário. Campo vazio usa o padrão (mínimo, custo e saldo inicial 0; sem
 * máximo). Texto que não é número ou negativo é recusado com o nome do campo, em vez de virar 0 sem aviso.
 */
export function readItemNumbers(form: ItemNumberFields): { minStock: number; maxStock: number | null; cost: number; initialQty: number } {
  const read = (text: string | undefined, label: string): number | null => {
    if (!text?.trim()) return null;
    const value = parseDecimal(text);
    if (!Number.isFinite(value) || value < 0) throw new StockError("valor_invalido", `${label}: informe um número igual ou maior que zero (ex.: 12,5).`);
    return value;
  };
  const minStock = roundQty(read(form.min_stock, "Estoque mínimo") ?? 0);
  const max = read(form.max_stock, "Estoque máximo");
  const maxStock = max == null ? null : roundQty(max);
  // Dinheiro em centavos (AGENTS §4): o mesmo valor que a tela mostra e que vai no pedido de compra da reposição.
  const cost = roundMoney(read(form.cost, "Custo") ?? 0);
  const initialQty = roundQty(read(form.initial_qty, "Saldo inicial") ?? 0);
  if (maxStock != null && maxStock < minStock) throw new StockError("valor_invalido", "O estoque máximo não pode ser menor que o mínimo.");
  return { minStock, maxStock, cost, initialQty };
}

/**
 * Custo unitário digitado numa entrada manual: vazio = usar o custo do item (null); número igual ou maior que zero vira
 * centavos. Texto que não é número ou negativo é recusado, em vez de virar o custo do item sem aviso.
 */
export function readUnitCost(text: string): number | null {
  if (!text.trim()) return null;
  const value = parseDecimal(text);
  if (!Number.isFinite(value) || value < 0) throw new StockError("valor_invalido", "Custo unitário: informe um número igual ou maior que zero (ex.: 12,50), ou deixe em branco para usar o custo do item.");
  return roundMoney(value);
}

export const INPUT = "h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring";
export const BUTTON_PRIMARY =
  "inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50";
export const BUTTON_OUTLINE = "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50";

const TYPE_TONE: Record<StockMovementType, string> = {
  entrada: "bg-status-success text-white",
  saida: "bg-status-orange text-white",
  transferencia: "bg-status-info text-white",
  ajuste: "bg-status-violet text-white",
};

export function MovementTypeBadge({ type }: { type: StockMovementType }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", TYPE_TONE[type] ?? "bg-status-neutral text-white")}>
      {MOVEMENT_TYPE_LABELS[type] ?? type}
    </span>
  );
}

export function ErrorBanner({ message, onClose }: { message: string | null; onClose?: () => void }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
      <AlertCircle size={16} className="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
      <p className="flex-1">{message}</p>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Fechar aviso" className="rounded p-0.5 text-muted-foreground hover:bg-muted">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

export function Field({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Carregando">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-12 animate-pulse rounded-lg bg-muted/30" />
      ))}
    </div>
  );
}

export function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}
