// Tabelas de preço: as tabelas numa tabela editável e, embaixo, os preços da tabela escolhida (também editáveis na
// própria linha). Reajuste por percentual num formulário na barra dos preços; excluir pede confirmação.
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Percent, Trash2 } from "lucide-react";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { usePermission } from "@/hooks/usePermission";
import { useRequiredSession } from "@/hooks/useSession";
import { savePriceListItemRows, savePriceListRows } from "@/lib/commercial/catalogEdits";
import { confirmAction } from "@/lib/confirm";
import { getDb } from "@/lib/db/client";
import { applyPercentToPriceList, deletePriceList, removePriceListItem } from "@/lib/erp/catalog";
import { isPriceListValid } from "@/lib/erp/pricing";
import { formatQty } from "@/lib/erp/stockPosting";
import { errorMessage, isTrue } from "@/lib/erp/tradeDb";
import { emit } from "@/lib/events/bus";
import { cn, formatCurrency, formatDay, todayIso } from "@/lib/utils";
import { ROW_ACTION, ROW_DANGER, refreshTrade, useEditActor } from "../components/inline";
import { BUTTON, INPUT, byId, invalidateTrade, num, useCustomers, usePriceListItems, usePriceLists, useProducts } from "../components/tradeKit";
import type { PriceList, PriceListItem, ProductKind } from "@/types";

type ListRow = PriceList & { prices: number };
type ItemRow = PriceListItem & { base: number; diff: number | null };

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
  const actor = useEditActor();
  const qc = useQueryClient();
  const canEdit = usePermission("edit", "products");
  const canDelete = usePermission("delete", "products");
  const today = todayIso();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [percent, setPercent] = useState("");
  const [percentKind, setPercentKind] = useState<"" | ProductKind>("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "status"; text: string } | null>(null);

  const { data: lists = [], isLoading } = usePriceLists(companyId);
  const { data: allItems = [] } = usePriceListItems(companyId);
  const { data: products = [] } = useProducts(companyId);
  const { data: customers = [] } = useCustomers(companyId);
  const productsById = useMemo(() => byId(products), [products]);

  const selected = lists.find((list) => list.id === selectedId) ?? lists.find((list) => isTrue(list.is_default)) ?? lists[0] ?? null;
  const listRows = useMemo<ListRow[]>(
    () => lists.map((list) => ({ ...list, is_default: isTrue(list.is_default) ? 1 : 0, active: isTrue(list.active) ? 1 : 0, prices: allItems.filter((item) => item.price_list_id === list.id && productsById.has(item.product_id)).length })),
    [lists, allItems, productsById],
  );
  const itemRows = useMemo<ItemRow[]>(
    () =>
      (selected ? allItems.filter((item) => item.price_list_id === selected.id && productsById.has(item.product_id)) : [])
        .sort((a, b) => (productsById.get(a.product_id)?.name ?? "").localeCompare(productsById.get(b.product_id)?.name ?? "", "pt-BR") || Number(a.min_qty) - Number(b.min_qty))
        .map((item) => {
          const base = Number(productsById.get(item.product_id)?.price ?? 0);
          return { ...item, base, diff: base > 0 ? Math.round(((Number(item.price) - base) / base) * 1000) / 10 : null };
        }),
    [allItems, selected, productsById],
  );
  const listCustomers = selected ? customers.filter((customer) => customer.price_list_id === selected.id) : [];

  async function log(type: string, title: string, entityId: string) {
    await emit({ type, companyId, actorId: session.user.id, entityType: "price_list", entityId, title, module: "catalog" });
  }

  const listColumns: EditableColumn<ListRow>[] = [
    {
      key: "name",
      header: "Tabela",
      kind: "text",
      required: true,
      width: 220,
      render: (row) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <button type="button" aria-label={`Abrir tabela ${row.name}`} aria-current={selected?.id === row.id ? "true" : undefined} className={cn("text-left font-medium hover:underline", selected?.id === row.id && "text-primary-text")} onClick={() => setSelectedId(row.id)}>
            {row.name}
          </button>
          {isTrue(row.is_default) && <Pill tone="primary">Padrão</Pill>}
          {!isTrue(row.active) ? <Pill>Inativa</Pill> : !isPriceListValid(row, today) && <Pill tone="danger">Fora da vigência</Pill>}
        </span>
      ),
    },
    { key: "description", header: "Descrição", kind: "text" },
    { key: "is_default", header: "Padrão", kind: "bool" },
    { key: "valid_from", header: "Vale a partir de", kind: "date" },
    { key: "valid_to", header: "Vale até", kind: "date" },
    { key: "active", header: "Ativa", kind: "bool" },
    { key: "prices", header: "Preços", kind: "number", readOnly: true },
  ];

  const activeProducts = products.filter((product) => isTrue(product.active));
  const itemColumns: EditableColumn<ItemRow>[] = [
    {
      key: "product_id",
      header: "Produto / serviço",
      kind: "select",
      required: true,
      width: 260,
      options: activeProducts.map((product) => ({ value: product.id, label: `${product.name}${product.sku ? ` (${product.sku})` : ""} · catálogo ${formatCurrency(Number(product.price))}` })),
      render: (row) => {
        const product = productsById.get(row.product_id);
        return (
          <span>
            <span className="font-medium">{product?.name ?? "Produto removido"}</span>
            {product && !isTrue(product.active) && <span className="ml-2 text-xs text-muted-foreground">(inativo)</span>}
          </span>
        );
      },
    },
    { key: "min_qty", header: "A partir de", kind: "number", render: (row) => <span className="tabular-nums">{formatQty(Number(row.min_qty))} {productsById.get(row.product_id)?.unit ?? ""}</span> },
    { key: "price", header: "Preço na tabela", kind: "money", required: true },
    { key: "base", header: "Catálogo", kind: "money", readOnly: true, render: (row) => <span className="tabular-nums text-muted-foreground">{formatCurrency(row.base)}</span> },
    { key: "diff", header: "Diferença", kind: "number", readOnly: true, render: (row) => <span className={cn("tabular-nums", row.diff != null && row.diff < 0 && "text-status-success")}>{row.diff == null ? "—" : `${row.diff > 0 ? "+" : ""}${row.diff.toLocaleString("pt-BR")}%`}</span> },
  ];

  async function saveLists(changes: EditableTableChanges<ListRow>) {
    const result = await savePriceListRows(await getDb(), companyId, actor, changes);
    const names = new Map(lists.map((list) => [list.id, list.name]));
    for (const id of result.updated) await log("price_list.updated", `Tabela de preço atualizada: ${names.get(id) ?? ""}`.trim(), id);
    for (const [index, id] of result.created.entries()) await log("price_list.created", `Tabela de preço criada: ${String(changes.created[index]?.name ?? "").trim()}`, id);
    if (result.created.length === 1) setSelectedId(result.created[0]!);
    invalidateTrade(qc);
  }

  async function saveItems(changes: EditableTableChanges<ItemRow>) {
    if (!selected) return;
    const result = await savePriceListItemRows(await getDb(), companyId, actor, changes, { priceListId: selected.id });
    if (result.created.length + result.updated.length > 0) await log("price_list.item_saved", `Preços em ${selected.name}: ${result.created.length} novos, ${result.updated.length} alterados`, selected.id);
    invalidateTrade(qc);
  }

  async function run(action: () => Promise<string | null>) {
    setNotice(null);
    setBusy(true);
    try {
      const text = await action();
      if (text) setNotice({ kind: "status", text });
      invalidateTrade(qc);
    } catch (error) {
      setNotice({ kind: "error", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function removeList(list: PriceList) {
    const ok = await confirmAction(`"${list.name}" e os preços dela saem do sistema. Clientes ligados a ela passam a usar a tabela padrão; pedidos antigos não mudam.`, { title: "Excluir tabela de preço?", okLabel: "Excluir" });
    if (!ok) return;
    await run(async () => {
      await deletePriceList(await getDb(), companyId, list.id);
      await log("price_list.deleted", `Tabela de preço excluída: ${list.name}`, list.id);
      if (selected?.id === list.id) setSelectedId(null);
      return null;
    });
  }

  async function removeItem(item: ItemRow) {
    const name = productsById.get(item.product_id)?.name ?? "produto";
    const ok = await confirmAction(`${name} volta a usar o preço do catálogo nesta faixa.`, { title: "Remover preço?", okLabel: "Remover" });
    if (!ok || !selected) return;
    await run(async () => {
      await removePriceListItem(await getDb(), companyId, item.id);
      await log("price_list.item_removed", `Preço removido de ${selected.name}: ${name}`, selected.id);
      return null;
    });
  }

  async function applyPercent() {
    if (!selected) return;
    const value = num(percent, Number.NaN);
    if (!Number.isFinite(value)) {
      setNotice({ kind: "error", text: "Informe o percentual (ex.: -10 para 10% abaixo do catálogo)." });
      return;
    }
    const scope = percentKind === "produto" ? "dos produtos ativos" : percentKind === "servico" ? "dos serviços ativos" : "dos itens ativos";
    const ok = await confirmAction(`O preço ${scope} em "${selected.name}" (a partir de 1 unidade) passa a ser o do catálogo ${value >= 0 ? "+" : ""}${value.toLocaleString("pt-BR")}%. Faixas de quantidade maiores ficam como estão.`, { title: "Aplicar percentual sobre o catálogo?", okLabel: "Aplicar" });
    if (!ok) return;
    await run(async () => {
      const result = await applyPercentToPriceList(await getDb(), companyId, selected.id, value, { kind: percentKind || undefined });
      await log("price_list.percent_applied", `${selected.name}: catálogo ${value >= 0 ? "+" : ""}${value}% (${result.created} novos, ${result.updated} atualizados)`, selected.id);
      setPercent("");
      return `Percentual aplicado: ${result.created} preços novos, ${result.updated} atualizados.`;
    });
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Tabelas de preço" />

      <EditableTable<ListRow>
        resource="products"
        title="Tabelas"
        label="Tabelas de preço"
        rows={listRows}
        columns={listColumns}
        loading={isLoading}
        onSave={saveLists}
        onRefresh={() => refreshTrade(qc)}
        newRow={() => ({ is_default: lists.length ? 0 : 1, active: 1 })}
        emptyMessage="Nenhuma tabela de preço"
        rowActions={(row) => (
          <>
            <button type="button" className={ROW_ACTION} aria-label={`Ver preços de ${row.name}`} onClick={() => setSelectedId(row.id)}>
              <FolderOpen size={13} /> Preços
            </button>
            {canDelete && (
              <button type="button" className={ROW_DANGER} aria-label={`Excluir tabela ${row.name}`} disabled={busy} onClick={() => void removeList(row)}>
                <Trash2 size={13} /> Excluir
              </button>
            )}
          </>
        )}
      />

      {notice && (
        <p role={notice.kind === "error" ? "alert" : "status"} className={cn("text-sm", notice.kind === "error" ? "text-destructive" : "text-muted-foreground")}>
          {notice.text}
        </p>
      )}

      {selected && (
        <section aria-label={`Tabela ${selected.name}`} className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {selected.description || validity(selected)} ·{" "}
            {listCustomers.length === 0 ? "Nenhum cliente" : `Clientes: ${listCustomers.slice(0, 5).map((customer) => customer.name).join(", ")}${listCustomers.length > 5 ? ` e mais ${listCustomers.length - 5}` : ""}`}
            {isTrue(selected.is_default) && " · Padrão"}
          </p>
          <EditableTable<ItemRow>
            key={selected.id}
            resource="products"
            title={`Preços em ${selected.name}`}
            label={`Preços da tabela ${selected.name}`}
            rows={itemRows}
            columns={itemColumns}
            onSave={saveItems}
            onRefresh={() => refreshTrade(qc)}
            newRow={() => ({ min_qty: 1 })}
            emptyMessage="Nenhum preço"
            actions={
              canEdit ? (
                <form
                  className="flex flex-wrap items-center gap-2"
                  aria-label="Aplicar percentual sobre o catálogo"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void applyPercent();
                  }}
                >
                  <input aria-label="Percentual (%)" inputMode="decimal" placeholder="% ex.: -10" value={percent} onChange={(event) => setPercent(event.target.value)} className={`${INPUT} h-8 w-28`} />
                  <select aria-label="Itens do reajuste" value={percentKind} onChange={(event) => setPercentKind(event.target.value as typeof percentKind)} className={`${INPUT} h-8 w-40`}>
                    <option value="">Produtos e serviços</option>
                    <option value="produto">Só produtos</option>
                    <option value="servico">Só serviços</option>
                  </select>
                  <button type="submit" className={BUTTON} disabled={busy}>
                    <Percent size={14} /> Aplicar % sobre o catálogo
                  </button>
                </form>
              ) : undefined
            }
            rowActions={
              canEdit
                ? (row) => (
                    <button type="button" className={ROW_DANGER} aria-label={`Remover preço de ${productsById.get(row.product_id)?.name ?? "produto"}`} disabled={busy} onClick={() => void removeItem(row)}>
                      <Trash2 size={13} /> Remover
                    </button>
                  )
                : undefined
            }
          />
        </section>
      )}
    </div>
  );
}
