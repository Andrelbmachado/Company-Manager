import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BadgeDollarSign, Pencil, Percent, Plus, Star, Trash2 } from "lucide-react";
import { CrudDialog, type CrudField } from "@/components/shared/CrudDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { usePermission } from "@/hooks/usePermission";
import { useRequiredSession } from "@/hooks/useSession";
import { getDb } from "@/lib/db/client";
import { applyPercentToPriceList, deletePriceList, removePriceListItem, savePriceList, savePriceListItem, type PriceListInput } from "@/lib/erp/catalog";
import { isPriceListValid } from "@/lib/erp/pricing";
import { formatQty } from "@/lib/erp/stockPosting";
import { isTrue } from "@/lib/erp/tradeDb";
import { emit } from "@/lib/events/bus";
import { cn, formatCurrency, formatDay, todayIso } from "@/lib/utils";
import { BUTTON, DANGER, ErrorNote, LoadingRows, PRIMARY, TD, TH, byId, invalidateTrade, num, useCustomers, usePriceListItems, usePriceLists, useProducts } from "../components/tradeKit";
import type { PriceList, PriceListItem, ProductKind } from "@/types";

type Dialog =
  | { kind: "list"; list: PriceList | null }
  | { kind: "item"; item: PriceListItem | null }
  | { kind: "percent" }
  | { kind: "delete-list" }
  | { kind: "delete-item"; item: PriceListItem };

const LIST_FIELDS: CrudField[] = [
  { key: "name", label: "Nome", required: true, placeholder: "Ex.: Revenda, Atacado, Black Friday" },
  { key: "isDefault", label: "Tabela padrão", type: "select", options: [{ value: "0", label: "Não" }, { value: "1", label: "Sim (vale para quem não tem tabela)" }] },
  { key: "validFrom", label: "Vale a partir de", type: "date" },
  { key: "validTo", label: "Vale até", type: "date" },
  { key: "active", label: "Situação", type: "select", options: [{ value: "1", label: "Ativa" }, { value: "0", label: "Inativa" }] },
  { key: "description", label: "Descrição", type: "textarea" },
];

function listInput(list: PriceList, patch: Partial<PriceListInput> = {}): PriceListInput {
  return { name: list.name, description: list.description, isDefault: isTrue(list.is_default), validFrom: list.valid_from, validTo: list.valid_to, active: isTrue(list.active), ...patch };
}

function validity(list: PriceList): string {
  if (list.valid_from && list.valid_to) return `De ${formatDay(list.valid_from)} a ${formatDay(list.valid_to)}`;
  if (list.valid_from) return `A partir de ${formatDay(list.valid_from)}`;
  if (list.valid_to) return `Até ${formatDay(list.valid_to)}`;
  return "Sem prazo";
}

function Pill({ children, tone = "muted" }: { children: string; tone?: "muted" | "primary" | "danger" }) {
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-semibold", tone === "primary" ? "bg-primary/15 text-primary-text" : tone === "danger" ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground")}>
      {children}
    </span>
  );
}

export default function PriceListsPage() {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const qc = useQueryClient();
  const canCreate = usePermission("create", "products");
  const canEdit = usePermission("edit", "products");
  const canDelete = usePermission("delete", "products");
  const today = todayIso();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});

  const { data: lists = [], isLoading } = usePriceLists(companyId);
  const { data: allItems = [] } = usePriceListItems(companyId);
  const { data: products = [] } = useProducts(companyId);
  const { data: customers = [] } = useCustomers(companyId);
  const productsById = useMemo(() => byId(products), [products]);

  const selected = lists.find((list) => list.id === selectedId) ?? lists.find((list) => isTrue(list.is_default)) ?? lists[0] ?? null;
  const items = useMemo(
    () => (selected ? allItems.filter((item) => item.price_list_id === selected.id && productsById.has(item.product_id)) : [])
      .sort((a, b) => (productsById.get(a.product_id)?.name ?? "").localeCompare(productsById.get(b.product_id)?.name ?? "", "pt-BR") || Number(a.min_qty) - Number(b.min_qty)),
    [allItems, selected, productsById],
  );
  const listCustomers = selected ? customers.filter((customer) => customer.price_list_id === selected.id) : [];

  const done = () => {
    invalidateTrade(qc);
    setDialog(null);
  };

  async function log(type: string, title: string, entityId: string) {
    await emit({ type, companyId, actorId: session.user.id, entityType: "price_list", entityId, title, module: "catalog" });
  }

  const saveList = useMutation({
    mutationFn: async () => {
      const editing = dialog?.kind === "list" ? dialog.list : null;
      const id = await savePriceList(await getDb(), companyId, { name: form.name, description: form.description, isDefault: form.isDefault === "1", validFrom: form.validFrom, validTo: form.validTo, active: form.active !== "0" }, editing?.id);
      await log(editing ? "price_list.updated" : "price_list.created", `${editing ? "Tabela de preço atualizada" : "Tabela de preço criada"}: ${form.name.trim()}`, id);
      return id;
    },
    onSuccess: (id) => {
      done();
      setSelectedId(id);
    },
  });

  const makeDefault = useMutation({
    mutationFn: async (list: PriceList) => {
      await savePriceList(await getDb(), companyId, listInput(list, { isDefault: true }), list.id);
      await log("price_list.default", `Tabela padrão: ${list.name}`, list.id);
    },
    onSuccess: () => invalidateTrade(qc),
  });

  const removeList = useMutation({
    mutationFn: async (list: PriceList) => {
      await deletePriceList(await getDb(), companyId, list.id);
      await log("price_list.deleted", `Tabela de preço excluída: ${list.name}`, list.id);
    },
    onSuccess: () => {
      done();
      setSelectedId(null);
    },
  });

  const saveItem = useMutation({
    mutationFn: async () => {
      if (!selected) return;
      const editing = dialog?.kind === "item" ? dialog.item : null;
      await savePriceListItem(await getDb(), companyId, { priceListId: selected.id, productId: form.productId, price: num(form.price, Number.NaN), minQty: num(form.minQty, 1) }, editing?.id);
      await log("price_list.item_saved", `Preço em ${selected.name}: ${productsById.get(form.productId)?.name ?? "produto"}`, selected.id);
    },
    onSuccess: done,
  });

  const removeItem = useMutation({
    mutationFn: async (item: PriceListItem) => {
      await removePriceListItem(await getDb(), companyId, item.id);
      if (selected) await log("price_list.item_removed", `Preço removido de ${selected.name}: ${productsById.get(item.product_id)?.name ?? "produto"}`, selected.id);
    },
    onSuccess: done,
  });

  const applyPercent = useMutation({
    mutationFn: async () => {
      if (!selected) return { created: 0, updated: 0 };
      const percent = num(form.percent, Number.NaN);
      const result = await applyPercentToPriceList(await getDb(), companyId, selected.id, percent, { kind: form.kind ? (form.kind as ProductKind) : undefined });
      await log("price_list.percent_applied", `${selected.name}: catálogo ${percent >= 0 ? "+" : ""}${percent}% (${result.created} novos, ${result.updated} atualizados)`, selected.id);
      return result;
    },
    onSuccess: done,
  });

  function open(next: Dialog, values: Record<string, string> = {}) {
    for (const mutation of [saveList, saveItem, applyPercent, removeList, removeItem]) mutation.reset();
    setForm(values);
    setDialog(next);
  }

  const activeProducts = products.filter((product) => isTrue(product.active) || (dialog?.kind === "item" && dialog.item?.product_id === product.id));
  const itemFields: CrudField[] = [
    { key: "productId", label: "Produto ou serviço", type: "select", required: true, options: [{ value: "", label: "Escolha..." }, ...activeProducts.map((product) => ({ value: product.id, label: `${product.name}${product.sku ? ` (${product.sku})` : ""} · catálogo ${formatCurrency(Number(product.price))}` }))] },
    { key: "minQty", label: "A partir de (quantidade)", type: "number" },
    { key: "price", label: "Preço nesta tabela (R$)", type: "number", required: true },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tabelas de preço"
        description="Preços especiais por cliente, canal ou período, com faixas por quantidade. Sem preço na tabela, vale o do catálogo."
        actions={canCreate ? <button type="button" className={PRIMARY} onClick={() => open({ kind: "list", list: null }, { name: "", description: "", isDefault: lists.length ? "0" : "1", validFrom: "", validTo: "", active: "1" })}><Plus size={14} /> Nova tabela</button> : undefined}
      />

      {isLoading ? <LoadingRows /> : lists.length === 0 ? (
        <EmptyState icon={BadgeDollarSign} title="Nenhuma tabela de preço" description="Crie uma tabela (ex.: Revenda) e ligue clientes a ela no CRM; os pedidos usam o preço da tabela automaticamente." />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
          <nav aria-label="Tabelas de preço" className="space-y-2">
            {lists.map((list) => {
              const count = allItems.filter((item) => item.price_list_id === list.id && productsById.has(item.product_id)).length;
              const valid = isPriceListValid(list, today);
              return (
                <button
                  key={list.id}
                  type="button"
                  aria-current={selected?.id === list.id ? "true" : undefined}
                  onClick={() => setSelectedId(list.id)}
                  className={cn("w-full rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted/30", selected?.id === list.id && "border-primary ring-1 ring-primary")}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{list.name}</span>
                    {isTrue(list.is_default) && <Pill tone="primary">Padrão</Pill>}
                    {!isTrue(list.active) ? <Pill>Inativa</Pill> : !valid && <Pill tone="danger">Fora da vigência</Pill>}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{validity(list)} · {count} {count === 1 ? "preço" : "preços"}</p>
                </button>
              );
            })}
          </nav>

          {selected && (
            <section aria-label={`Tabela ${selected.name}`} className="space-y-4 rounded-xl border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{selected.name}</h2>
                  <p className="text-sm text-muted-foreground">{selected.description || validity(selected)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {listCustomers.length === 0 ? "Nenhum cliente ligado a esta tabela." : `Clientes: ${listCustomers.slice(0, 5).map((customer) => customer.name).join(", ")}${listCustomers.length > 5 ? ` e mais ${listCustomers.length - 5}` : ""}.`}
                    {isTrue(selected.is_default) && " Também vale para clientes sem tabela."}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {canEdit && <button type="button" className={BUTTON} onClick={() => open({ kind: "list", list: selected }, { name: selected.name, description: selected.description ?? "", isDefault: isTrue(selected.is_default) ? "1" : "0", validFrom: selected.valid_from ?? "", validTo: selected.valid_to ?? "", active: isTrue(selected.active) ? "1" : "0" })}><Pencil size={14} /> Editar</button>}
                  {canEdit && !isTrue(selected.is_default) && <button type="button" className={BUTTON} disabled={makeDefault.isPending} onClick={() => makeDefault.mutate(selected)}><Star size={14} /> Tornar padrão</button>}
                  {canEdit && <button type="button" className={BUTTON} onClick={() => open({ kind: "percent" }, { percent: "", kind: "" })}><Percent size={14} /> Aplicar % sobre o catálogo</button>}
                  {canDelete && <button type="button" className={DANGER} onClick={() => open({ kind: "delete-list" })}><Trash2 size={14} /> Excluir</button>}
                </div>
              </div>
              <ErrorNote error={makeDefault.error} />

              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Preços</h3>
                {canEdit && <button type="button" className={PRIMARY} onClick={() => open({ kind: "item", item: null }, { productId: "", minQty: "1", price: "" })}><Plus size={14} /> Adicionar preço</button>}
              </div>
              {items.length === 0 ? <p className="text-sm text-muted-foreground">Esta tabela ainda não tem preços; os pedidos usam o preço do catálogo.</p> : (
                <div className="overflow-x-auto rounded-xl border">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="bg-muted/30">
                      <tr>
                        <th className={TH}>Produto / serviço</th>
                        <th className={`${TH} text-right`}>A partir de</th>
                        <th className={`${TH} text-right`}>Preço na tabela</th>
                        <th className={`${TH} text-right`}>Catálogo</th>
                        <th className={`${TH} text-right`}>Diferença</th>
                        {canEdit && <th className={TH}><span className="sr-only">Ações</span></th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {items.map((item) => {
                        const product = productsById.get(item.product_id)!;
                        const base = Number(product.price);
                        const diff = base > 0 ? Math.round(((Number(item.price) - base) / base) * 1000) / 10 : null;
                        return (
                          <tr key={item.id}>
                            <td className={TD}>
                              <span className="font-medium">{product.name}</span>
                              {!isTrue(product.active) && <span className="ml-2 text-xs text-muted-foreground">(inativo)</span>}
                            </td>
                            <td className={`${TD} text-right tabular-nums`}>{formatQty(Number(item.min_qty))} {product.unit}</td>
                            <td className={`${TD} text-right font-medium tabular-nums`}>{formatCurrency(Number(item.price))}</td>
                            <td className={`${TD} text-right tabular-nums text-muted-foreground`}>{formatCurrency(base)}</td>
                            <td className={`${TD} text-right tabular-nums ${diff != null && diff < 0 ? "text-status-success" : ""}`}>{diff == null ? "—" : `${diff > 0 ? "+" : ""}${diff.toLocaleString("pt-BR")}%`}</td>
                            {canEdit && (
                              <td className={`${TD} text-right`}>
                                <button type="button" aria-label={`Editar preço de ${product.name}`} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => open({ kind: "item", item }, { productId: item.product_id, minQty: String(item.min_qty), price: String(item.price) })}><Pencil size={14} /></button>
                                <button type="button" aria-label={`Remover preço de ${product.name}`} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive" onClick={() => open({ kind: "delete-item", item })}><Trash2 size={14} /></button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {dialog?.kind === "list" && (
        <CrudDialog title={dialog.list ? "Editar tabela de preço" : "Nova tabela de preço"} fields={LIST_FIELDS} values={form} onChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))} onClose={() => setDialog(null)} onSubmit={() => saveList.mutate()} busy={saveList.isPending}>
          {form.isDefault === "1" && <p className="mt-4 text-xs text-muted-foreground">Só uma tabela é padrão: a atual deixa de ser.</p>}
          <ErrorNote error={saveList.error} className="mt-4" />
        </CrudDialog>
      )}

      {dialog?.kind === "item" && (
        <CrudDialog
          title={dialog.item ? "Editar preço" : "Adicionar preço"}
          fields={itemFields}
          values={form}
          onChange={(key, value) => setForm((current) => {
            const next = { ...current, [key]: value };
            if (key === "productId" && !current.price) next.price = String(productsById.get(value)?.price ?? "");
            return next;
          })}
          onClose={() => setDialog(null)}
          onSubmit={() => saveItem.mutate()}
          busy={saveItem.isPending}
        >
          <p className="mt-4 text-xs text-muted-foreground">Faixas: cadastre o mesmo produto com quantidades mínimas diferentes (ex.: 1, 10, 50). No pedido vale a maior faixa alcançada.</p>
          <ErrorNote error={saveItem.error} className="mt-3" />
        </CrudDialog>
      )}

      {dialog?.kind === "percent" && selected && (
        <CrudDialog
          title="Aplicar percentual sobre o catálogo"
          fields={[
            { key: "percent", label: "Percentual (%)", type: "number", required: true, placeholder: "Ex.: -10 para 10% abaixo" },
            { key: "kind", label: "Itens", type: "select", options: [{ value: "", label: "Produtos e serviços" }, { value: "produto", label: "Só produtos" }, { value: "servico", label: "Só serviços" }] },
          ]}
          values={form}
          onChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))}
          onClose={() => setDialog(null)}
          onSubmit={() => applyPercent.mutate()}
          busy={applyPercent.isPending}
          submitLabel="Aplicar"
        >
          <p className="mt-4 text-xs text-muted-foreground">Para cada item ativo, o preço em "{selected.name}" (a partir de 1 unidade) passa a ser o preço do catálogo com o percentual. Faixas de quantidade maiores ficam como estão.</p>
          <ErrorNote error={applyPercent.error} className="mt-3" />
        </CrudDialog>
      )}

      {dialog?.kind === "delete-list" && selected && (
        <CrudDialog title="Excluir tabela de preço?" fields={[]} values={{}} onChange={() => undefined} onClose={() => setDialog(null)} onSubmit={() => removeList.mutate(selected)} busy={removeList.isPending} submitLabel="Excluir">
          <p className="text-sm text-muted-foreground">"{selected.name}" e os preços dela saem do sistema. Clientes ligados a ela passam a usar a tabela padrão; pedidos antigos não mudam.</p>
          <ErrorNote error={removeList.error} className="mt-3" />
        </CrudDialog>
      )}

      {dialog?.kind === "delete-item" && (
        <CrudDialog title="Remover preço?" fields={[]} values={{}} onChange={() => undefined} onClose={() => setDialog(null)} onSubmit={() => removeItem.mutate(dialog.item)} busy={removeItem.isPending} submitLabel="Remover">
          <p className="text-sm text-muted-foreground">{productsById.get(dialog.item.product_id)?.name} volta a usar o preço do catálogo nesta faixa.</p>
          <ErrorNote error={removeItem.error} className="mt-3" />
        </CrudDialog>
      )}
    </div>
  );
}
