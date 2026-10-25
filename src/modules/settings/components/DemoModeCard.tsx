// Configurações > Modo demonstração (só CEO e Administração: recurso demo_mode). Ligar semeia os dados de exemplo;
// desligar pergunta antes e apaga só eles (leads e o que a pessoa cadastrou ficam). Regras em src/lib/demo.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Loader2 } from "lucide-react";
import { useRequiredSession } from "@/hooks/useSession";
import { usePermission } from "@/hooks/usePermission";
import { getDb, isTauriRuntime } from "@/lib/db/client";
import { confirmAction } from "@/lib/confirm";
import { changeDemoMode, isDemoMode, type DemoModeResult } from "@/lib/demo/demoMode";
import { countDemoRows, type DemoRowCount } from "@/lib/demo/purge";
import { cn } from "@/lib/utils";
import type { Role } from "@/types";

export const demoModeQueryKey = (companyId: string) => ["settings", companyId, "demo-mode"] as const;

interface DemoModeState {
  on: boolean;
  /** Com o modo desligado: linhas de exemplo que ainda estão no banco (presas a dados da pessoa). */
  left: DemoRowCount;
}

const TABLE_LABELS: Record<string, string> = {
  customers: "clientes",
  contacts: "contatos",
  opportunities: "oportunidades",
  proposals: "propostas",
  suppliers: "fornecedores",
  payables: "contas a pagar",
  receivables: "contas a receber",
  cost_centers: "centros de custo",
  finance_categories: "categorias financeiras",
  bank_accounts: "contas bancárias",
  recurring_entries: "recorrências",
  inventory_items: "itens de estoque",
  stock_locations: "locais de estoque",
  stock_balances: "saldos de estoque",
  products: "produtos",
  price_lists: "tabelas de preço",
  projects: "projetos",
  project_stages: "etapas de projeto",
  tasks: "tarefas",
  employees: "colaboradores",
  sales_orders: "pedidos de venda",
  invoices: "faturas",
  purchase_orders: "pedidos de compra",
  tickets: "chamados",
  work_orders: "ordens de serviço",
  documents: "documentos",
  settings: "configurações",
};

const AREA_LABELS: Record<string, string> = {
  catalog: "Catálogo",
  crm: "CRM",
  finance: "Financeiro",
  hr: "RH",
  imports: "Importação",
  inventory: "Estoque",
  purchasing: "Compras",
  sales: "Vendas",
  settlements: "Baixas e extrato",
};

const number = (n: number) => n.toLocaleString("pt-BR");
const records = (n: number) => `${number(n)} ${n === 1 ? "registro" : "registros"} de exemplo`;

function tableDetail(byTable: Record<string, number>): string {
  return Object.entries(byTable)
    .sort(([, a], [, b]) => b - a)
    .map(([table, n]) => `${TABLE_LABELS[table] ?? table.replace(/_/g, " ")}: ${number(n)}`)
    .join(", ");
}

function describeResult(result: DemoModeResult, on: boolean): string {
  if (on) {
    const inserted = result.inserted ?? 0;
    let text = inserted > 0
      ? `Modo demonstração ligado: ${records(inserted)} ${inserted === 1 ? "adicionado" : "adicionados"}.`
      : "Modo demonstração ligado. Os dados de exemplo já estavam no banco.";
    if (result.failed?.length) text += ` Não foi possível criar os exemplos de: ${result.failed.map((area) => AREA_LABELS[area.name] ?? area.name).join(", ")}.`;
    return text;
  }
  const removed = result.removed ?? 0;
  let text = `Modo demonstração desligado: ${records(removed)} ${removed === 1 ? "removido" : "removidos"}. Leads e o que você cadastrou ficaram.`;
  if (result.kept) text += ` ${records(result.kept)} ${result.kept === 1 ? "ficou" : "ficaram"} porque dados seus apontam para ${result.kept === 1 ? "ele" : "eles"} (${tableDetail(result.keptByTable ?? {})}).`;
  return text;
}

export function DemoModeCard() {
  const allowed = usePermission("edit", "demo_mode");
  return allowed ? <DemoModeSwitch /> : null;
}

function DemoModeSwitch() {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const desktop = isTauriRuntime();
  const qc = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const state = useQuery({
    queryKey: demoModeQueryKey(companyId),
    enabled: desktop,
    queryFn: async (): Promise<DemoModeState> => {
      const db = await getDb();
      const on = await isDemoMode(db, companyId);
      return { on, left: on ? { total: 0, byTable: {} } : await countDemoRows(db, companyId) };
    },
  });

  const mutation = useMutation({
    mutationFn: async (on: boolean) => changeDemoMode(await getDb(), companyId, { role: session.membership.role as Role, userId: session.user.id }, on),
    onSuccess: (result, on) => {
      setMessage(describeResult(result, on));
      qc.setQueryData<DemoModeState>(demoModeQueryKey(companyId), {
        on,
        left: on ? { total: 0, byTable: {} } : { total: result.kept ?? 0, byTable: result.keptByTable ?? {} },
      });
      // Os dados de todos os módulos mudaram.
      void qc.invalidateQueries();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Não foi possível mudar o modo demonstração."),
  });

  async function change(next: boolean) {
    setMessage(null);
    setError(null);
    if (!next) {
      const ok = await confirmAction(
        "Os dados de exemplo de todos os módulos (clientes, financeiro, estoque, projetos, RH...) serão apagados. Leads e os registros que você cadastrou ficam. Continuar?",
        { title: "Desligar o modo demonstração", okLabel: "Apagar dados de exemplo" },
      );
      if (!ok) return;
    }
    mutation.mutate(next);
  }

  const on = desktop ? state.data?.on ?? false : true;
  const busy = mutation.isPending;
  const disabled = !desktop || state.isLoading || busy;
  const left = desktop && !on && !busy ? state.data?.left : undefined;

  return (
    <section aria-labelledby="demo-mode-title" className="rounded-xl border bg-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <FlaskConical size={18} className="text-primary-text" />
          </div>
          <div>
            <h3 id="demo-mode-title" className="text-sm font-semibold">Modo demonstração</h3>
            <p className="text-xs text-muted-foreground">Preenche os módulos com dados de exemplo para conhecer o sistema. Leads nunca são tocados.</p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Modo demonstração"
          disabled={disabled}
          title={desktop ? undefined : "No navegador o banco inteiro já é de demonstração"}
          onClick={() => void change(!on)}
          className={cn(
            "relative mt-1 inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-60",
            on ? "border-primary bg-primary" : "border-input bg-muted",
          )}
        >
          <span
            className={cn(
              "inline-block h-3.5 w-3.5 rounded-full transition-transform",
              on ? "translate-x-[1.1rem] bg-primary-foreground" : "translate-x-0.5 bg-muted-foreground",
            )}
          />
        </button>
      </div>

      {busy && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
          {mutation.variables ? "Adicionando dados de exemplo…" : "Removendo dados de exemplo…"}
        </p>
      )}
      {message && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">{message}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {state.isError && <p role="alert" className="text-sm text-destructive">Não foi possível ler o modo demonstração.</p>}
      {left && left.total > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <p>
            Ainda há {records(left.total)} ({tableDetail(left.byTable)}): {left.total === 1 ? "fica" : "ficam"} enquanto algum dado seu apontar para {left.total === 1 ? "ele" : "eles"}.
          </p>
          <button type="button" onClick={() => void change(false)} className="rounded-md border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted">
            Remover agora
          </button>
        </div>
      )}
      {!desktop && (
        <p className="text-xs text-muted-foreground">
          No navegador o banco inteiro já é de demonstração (empresa TechFlow). O switch liga e desliga os dados de exemplo no app desktop.
        </p>
      )}
    </section>
  );
}
