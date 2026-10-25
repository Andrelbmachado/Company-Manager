// Peças comuns das telas do financeiro: cadastros auxiliares (plano de contas, centros de custo, contas bancárias,
// fornecedores e clientes), invalidação das consultas, opções de formulário e formatação de valores.
import { useState, type ReactNode } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { isTrue } from "@/lib/erp/financeCommon";
import { cn, formatCurrency } from "@/lib/utils";
import type { BankAccount, BankAccountKind, CostCenter, Customer, FinanceCategory, Supplier } from "@/types";

export const inputClass = "h-9 min-w-0 max-w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring";
export const primaryButton = "flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50";
export const secondaryButton = "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";
export const dangerButton = "flex items-center gap-1.5 rounded-md border border-destructive/40 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50";
export const th = "whitespace-nowrap px-4 py-3 text-left font-medium text-muted-foreground";
export const td = "px-4 py-3";

export const PAYMENT_METHODS = [
  { value: "pix", label: "Pix" },
  { value: "boleto", label: "Boleto" },
  { value: "transferencia", label: "Transferência" },
  { value: "cartao", label: "Cartão" },
  { value: "dinheiro", label: "Dinheiro" },
  { value: "cheque", label: "Cheque" },
  { value: "debito_automatico", label: "Débito automático" },
];

export const BANK_ACCOUNT_KIND_LABELS: Record<BankAccountKind, string> = {
  corrente: "Conta corrente",
  poupanca: "Poupança",
  caixa: "Caixa (dinheiro)",
  cartao: "Cartão",
  investimento: "Investimento",
};

export const paymentMethodLabel = (value: string | null | undefined) => PAYMENT_METHODS.find((method) => method.value === value)?.label ?? value ?? "—";

/** Opções de <select> com a primeira opção vazia. */
export function withEmpty(options: { value: string; label: string }[], emptyLabel = "—"): { value: string; label: string }[] {
  return [{ value: "", label: emptyLabel }, ...options];
}

export interface CategoryNode {
  category: FinanceCategory;
  depth: number;
}

/** Plano de contas em árvore (pais antes dos filhos, por código/posição), com a profundidade de cada um. */
export function categoryTree(categories: readonly FinanceCategory[]): CategoryNode[] {
  const byParent = new Map<string | null, FinanceCategory[]>();
  const ids = new Set(categories.map((category) => category.id));
  for (const category of categories) {
    const parent = category.parent_id && ids.has(category.parent_id) ? category.parent_id : null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), category]);
  }
  const order = (a: FinanceCategory, b: FinanceCategory) =>
    (a.code ?? "").localeCompare(b.code ?? "", "pt-BR", { numeric: true }) || Number(a.position) - Number(b.position) || a.name.localeCompare(b.name, "pt-BR");
  const result: CategoryNode[] = [];
  const visit = (parent: string | null, depth: number, seen: Set<string>) => {
    for (const category of [...(byParent.get(parent) ?? [])].sort(order)) {
      if (seen.has(category.id)) continue;
      seen.add(category.id);
      result.push({ category, depth });
      visit(category.id, depth + 1, seen);
    }
  };
  visit(null, 0, new Set());
  return result;
}

export const categoryLabel = (category: Pick<FinanceCategory, "code" | "name">) => (category.code ? `${category.code} · ${category.name}` : category.name);

/** Categorias ativas do tipo, em árvore, como opções de formulário. */
export function categoryOptions(categories: readonly FinanceCategory[], kind?: "receita" | "despesa"): { value: string; label: string }[] {
  return categoryTree(categories.filter((category) => isTrue(category.active)))
    .filter(({ category }) => !kind || category.kind === kind)
    .map(({ category, depth }) => ({ value: category.id, label: `${"  ".repeat(depth)}${categoryLabel(category)}` }));
}

export interface FinanceLookups {
  categories: FinanceCategory[];
  costCenters: CostCenter[];
  bankAccounts: BankAccount[];
  suppliers: Pick<Supplier, "id" | "name">[];
  customers: Pick<Customer, "id" | "name">[];
  categoryName: (id: string | null | undefined) => string;
  costCenterName: (id: string | null | undefined) => string;
  bankAccountName: (id: string | null | undefined) => string;
  partyName: (kind: "payable" | "receivable", id: string | null | undefined) => string;
  defaultBankAccountId: string | null;
}

const byName = <T extends { name: string }>(rows: T[]) => [...rows].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

/**
 * Cadastros usados pelas telas do financeiro. Clientes e fornecedores vêm só com nome, para identificar a conta
 * (quem recebe/paga); o cadastro completo continua no CRM e em Compras.
 */
export function useFinanceLookups(companyId: string): FinanceLookups {
  const { data: categories = [] } = useQuery({
    queryKey: ["finance_categories", companyId],
    queryFn: async () => (await getDb()).select<FinanceCategory[]>("SELECT * FROM finance_categories WHERE company_id=? AND deleted_at IS NULL", [companyId]),
  });
  const { data: costCenters = [] } = useQuery({
    queryKey: ["cost_centers", companyId],
    queryFn: async () => byName(await (await getDb()).select<CostCenter[]>("SELECT * FROM cost_centers WHERE company_id=? AND deleted_at IS NULL", [companyId])),
  });
  const { data: bankAccounts = [] } = useQuery({
    queryKey: ["bank_accounts", companyId],
    queryFn: async () => byName(await (await getDb()).select<BankAccount[]>("SELECT * FROM bank_accounts WHERE company_id=? AND deleted_at IS NULL", [companyId])),
  });
  const { data: suppliers = [] } = useQuery({
    queryKey: ["finance", companyId, "suppliers"],
    queryFn: async () => byName(await (await getDb()).select<Supplier[]>("SELECT * FROM suppliers WHERE company_id=? AND deleted_at IS NULL", [companyId])).map(({ id, name }) => ({ id, name })),
  });
  const { data: customers = [] } = useQuery({
    queryKey: ["finance", companyId, "customers"],
    queryFn: async () => byName(await (await getDb()).select<Customer[]>("SELECT * FROM customers WHERE company_id=? AND deleted_at IS NULL", [companyId])).map(({ id, name }) => ({ id, name })),
  });
  const find = <T extends { id: string; name: string }>(rows: T[], id: string | null | undefined) => (id ? (rows.find((row) => row.id === id)?.name ?? "—") : "—");
  return {
    categories,
    costCenters,
    bankAccounts,
    suppliers,
    customers,
    categoryName: (id) => {
      const category = id ? categories.find((row) => row.id === id) : undefined;
      return category ? categoryLabel(category) : "—";
    },
    costCenterName: (id) => find(costCenters, id),
    bankAccountName: (id) => find(bankAccounts, id),
    partyName: (kind, id) => find(kind === "payable" ? suppliers : customers, id),
    defaultBankAccountId: (bankAccounts.find((account) => isTrue(account.is_default) && isTrue(account.active)) ?? bankAccounts.find((account) => isTrue(account.active)))?.id ?? null,
  };
}

/** Depois de qualquer gravação no financeiro: listas, fluxo, DRE, saldos, extrato e o Dashboard. */
export function invalidateFinance(qc: QueryClient, companyId: string): void {
  for (const key of ["payables", "receivables", "finance", "bank_accounts", "finance_categories", "cost_centers", "recurring_entries"]) {
    void qc.invalidateQueries({ queryKey: [key, companyId] });
  }
  void qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
}

/** Valor com cor: entrada em verde, saída em vermelho (texto com contraste nos dois temas). */
export function Money({ value, signed = false, className }: { value: number; signed?: boolean; className?: string }) {
  const tone = value > 0 ? "text-emerald-700 dark:text-emerald-400" : value < 0 ? "text-red-700 dark:text-red-400" : "text-muted-foreground";
  return <span className={cn("tabular-nums", signed && tone, className)}>{signed && value > 0 ? "+" : ""}{formatCurrency(value)}</span>;
}

export function ErrorNote({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" /> {message}
    </p>
  );
}

export function SuccessNote({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  return (
    <div role="status" className="flex items-start justify-between gap-3 rounded-md border border-emerald-600/30 bg-emerald-600/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300">
      <span className="flex items-start gap-2"><CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden="true" /> {children}</span>
      {onClose && <button type="button" onClick={onClose} className="text-xs underline">Fechar</button>}
    </div>
  );
}

/** Mensagem de erro de uma exceção (as regras do lib/erp lançam Error com texto para a pessoa). */
export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Não foi possível concluir. Tente de novo.");

/**
 * Botão de ação irreversível em dois passos (sem window.confirm): o primeiro clique troca o botão por
 * "Confirmar …" e "Voltar".
 */
export function ConfirmButton({ label, confirmLabel, onConfirm, icon, disabled, busy, tone = "danger", ariaLabel }: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  icon?: ReactNode;
  disabled?: boolean;
  busy?: boolean;
  tone?: "danger" | "neutral";
  /** Nome acessível do primeiro botão quando ele só tem ícone. */
  ariaLabel?: string;
}) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <button type="button" disabled={disabled || busy} onClick={() => setArmed(true)} aria-label={ariaLabel} title={ariaLabel} className={cn(tone === "danger" ? dangerButton : secondaryButton, !label && "px-2")}>
        {icon}
        {label && ` ${label}`}
      </button>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      <button type="button" disabled={busy} onClick={() => { setArmed(false); onConfirm(); }} className={cn(dangerButton, "bg-destructive/10")}>
        {confirmLabel}
      </button>
      <button type="button" onClick={() => setArmed(false)} className={secondaryButton}>Voltar</button>
    </span>
  );
}

/** Campo com rótulo para filtros e formulários no próprio lugar. */
export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("flex min-w-0 max-w-full flex-col gap-1 text-xs font-medium text-muted-foreground", className)}>
      {label}
      {children}
    </label>
  );
}
