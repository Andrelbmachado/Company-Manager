// Fornecedores editados na própria tabela (documento, contato, condição, avaliação e endereço em colunas). A ficha abre
// abaixo da lista, no próprio lugar, com os pedidos de compra do fornecedor; exclusão com confirmação em dois passos.
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { FileText, Star, Trash2, Truck } from "lucide-react";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { ImportExportButtons } from "@/components/shared/ImportExportButtons";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { usePermission } from "@/hooks/usePermission";
import { getDb } from "@/lib/db/client";
import { formatSequence } from "@/lib/db/sequence";
import { deleteSupplier, formatAddress, supplierAddress } from "@/lib/erp/suppliers";
import { emit } from "@/lib/events/bus";
import { useLabel } from "@/lib/labels/useLabel";
import { sumMoney } from "@/lib/money";
import { formatCurrency, formatDay } from "@/lib/utils";
import { BUTTON, ErrorNote, PRIMARY, invalidateTrade, usePurchaseOrders, useSuppliers } from "@/modules/catalog/components/tradeKit";
import { ConfirmButton } from "@/modules/finance/components/financeShared";
import { InfoGrid, InfoItem, InlinePanel } from "@/modules/finance/components/inline";
import { useEditContext } from "@/modules/finance/data/useEditContext";
import type { PurchaseOrder, Supplier } from "@/types";
import { saveSupplierChanges, supplierRow, type SupplierRow } from "../data/supplierEditing";

const OPEN_PO = new Set(["rascunho", "aprovado", "enviado", "recebido_parcial"]);
const RATING_OPTIONS = [1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: `${value} de 5` }));

function Rating({ value }: { value: number | null | undefined }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} de 5`} title={`${value} de 5`}>
      {[1, 2, 3, 4, 5].map((star) => <Star key={star} size={13} className={star <= value ? "fill-current text-status-warning" : "text-muted-foreground/40"} aria-hidden="true" />)}
    </span>
  );
}

const COLUMNS: EditableColumn<SupplierRow>[] = [
  { key: "name", header: "Razão social / nome", kind: "text", required: true, width: 220, render: (row) => <span className="font-medium">{row.name}</span> },
  { key: "trade_name", header: "Nome fantasia", kind: "text" },
  { key: "document", header: "CNPJ / CPF", kind: "text", placeholder: "00.000.000/0001-00", width: 170 },
  { key: "state_registration", header: "Inscrição estadual", kind: "text" },
  { key: "contact_name", header: "Contato", kind: "text" },
  { key: "email", header: "E-mail", kind: "email", width: 200 },
  { key: "phone", header: "Telefone", kind: "phone" },
  { key: "website", header: "Site", kind: "text" },
  { key: "category", header: "Categoria", kind: "text", placeholder: "Ex.: Eletrônicos" },
  { key: "terms", header: "Condição de pagamento", kind: "text", placeholder: "Ex.: 28 dias" },
  { key: "rating", header: "Avaliação", kind: "select", options: RATING_OPTIONS, placeholder: "Sem avaliação", render: (row) => <Rating value={row.rating ? Number(row.rating) : null} /> },
  { key: "logradouro", header: "Logradouro", kind: "text", width: 200 },
  { key: "numero", header: "Número", kind: "text", width: 90 },
  { key: "complemento", header: "Complemento", kind: "text" },
  { key: "bairro", header: "Bairro", kind: "text" },
  { key: "cidade", header: "Cidade", kind: "text" },
  { key: "uf", header: "UF", kind: "text", width: 70 },
  { key: "cep", header: "CEP", kind: "text", width: 110 },
  { key: "notes", header: "Observações", kind: "text", width: 200 },
];
const ORDERS_COLUMN: EditableColumn<SupplierRow> = { key: "open_orders", header: "Pedidos em aberto", kind: "number", readOnly: true, render: (row) => (row.open_orders ? String(row.open_orders) : <span className="text-muted-foreground">—</span>) };

export default function SuppliersPage() {
  const ctx = useEditContext();
  const companyId = ctx.companyId;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const title = useLabel("module.suppliers");
  const canDelete = usePermission("delete", "suppliers");
  const canCreateOrder = usePermission("create", "purchase_orders");
  const canSeeOrders = usePermission("view", "purchase_orders");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const suppliersQuery = useSuppliers(companyId);
  const { data: orders = [] } = usePurchaseOrders(companyId, canSeeOrders);
  const suppliers = useMemo(() => suppliersQuery.data ?? [], [suppliersQuery.data]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return suppliers;
    const digits = term.replace(/\D/g, "");
    return suppliers.filter((supplier) =>
      [supplier.name, supplier.trade_name, supplier.email, supplier.category, supplier.contact_name].some((value) => value?.toLowerCase().includes(term)) ||
      (digits.length >= 3 && (supplier.document ?? "").replace(/\D/g, "").includes(digits)));
  }, [suppliers, search]);
  const openOrders = (id: string) => orders.filter((order) => order.supplier_id === id && OPEN_PO.has(order.status)).length;
  const rows = filtered.map((supplier) => supplierRow(supplier, openOrders(supplier.id)));
  const columns = canSeeOrders ? [...COLUMNS, ORDERS_COLUMN] : COLUMNS;

  const selected = suppliers.find((supplier) => supplier.id === selectedId) ?? null;

  async function save(changes: EditableTableChanges<SupplierRow>) {
    await saveSupplierChanges(await getDb(), ctx, changes);
    invalidateTrade(qc);
    void qc.invalidateQueries({ queryKey: ["supplier-options"] });
  }

  const remove = useMutation({
    mutationFn: async (supplier: Supplier) => {
      await deleteSupplier(await getDb(), companyId, supplier.id);
      await emit({ type: "supplier.deleted", companyId, actorId: ctx.userId, entityType: "supplier", entityId: supplier.id, title: `Fornecedor excluído: ${supplier.name}`, module: "purchasing" });
      return supplier;
    },
    onSuccess: (supplier) => {
      invalidateTrade(qc);
      void qc.invalidateQueries({ queryKey: ["supplier-options"] });
      if (selectedId === supplier.id) setSelectedId(null);
    },
  });

  return (
    <div className="space-y-5">
      <PageHeader title={title} />
      <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar por nome, CNPJ, categoria..." />
      <ErrorNote error={remove.error} />

      <EditableTable<SupplierRow>
        resource="suppliers"
        label="Fornecedores"
        rows={rows}
        columns={columns}
        loading={suppliersQuery.isLoading}
        onSave={save}
        onRefresh={() => qc.invalidateQueries({ queryKey: ["suppliers", companyId] })}
        emptyMessage={suppliers.length ? "Nenhum fornecedor encontrado. Tente outro termo de busca." : "Nenhum fornecedor cadastrado. Adicione os fornecedores para usar nos pedidos de compra."}
        actions={<ImportExportButtons entity="suppliers" onImported={() => invalidateTrade(qc)} />}
        rowActions={(row) => {
          const supplier = suppliers.find((candidate) => candidate.id === row.id);
          return (
            <span className="flex justify-end gap-1.5">
              <button type="button" className={BUTTON} onClick={() => { remove.reset(); setSelectedId(row.id); }} aria-label={`Ficha de ${row.name}`}>
                <FileText size={14} aria-hidden="true" /> Ficha
              </button>
              {canDelete && supplier && (
                <ConfirmButton label="" ariaLabel={`Excluir ${row.name}`} confirmLabel="Confirmar exclusão" icon={<Trash2 size={14} aria-hidden="true" />} busy={remove.isPending} onConfirm={() => remove.mutate(supplier)} />
              )}
            </span>
          );
        }}
      />
      <p className="text-sm text-muted-foreground">Fornecedor excluído aparece como "Fornecedor removido" nos pedidos e recebimentos antigos. Não dá para excluir com pedido de compra em andamento.</p>

      {selected && (
        <InlinePanel key={selected.id} title={selected.name} subtitle="Fornecedor" onClose={() => setSelectedId(null)}>
          <InfoGrid>
            <InfoItem label="Nome fantasia" value={selected.trade_name} />
            <InfoItem label="CNPJ / CPF" value={selected.document} />
            <InfoItem label="Contato" value={selected.contact_name} />
            <InfoItem label="E-mail" value={selected.email ? <a className="hover:underline" href={`mailto:${selected.email}`}>{selected.email}</a> : null} />
            <InfoItem label="Telefone" value={selected.phone} />
            <InfoItem label="Condição de pagamento" value={selected.terms} />
            <InfoItem label="Avaliação" value={<Rating value={selected.rating} />} />
            <InfoItem label="Endereço" value={formatAddress(supplierAddress(selected))} />
          </InfoGrid>
          {selected.notes && <p className="whitespace-pre-wrap text-sm">{selected.notes}</p>}

          {canSeeOrders && <SupplierOrders supplier={selected} orders={orders} canCreateOrder={canCreateOrder} onNewOrder={() => navigate(`/purchasing/pedidos/nova?fornecedor=${encodeURIComponent(selected.id)}`)} />}
        </InlinePanel>
      )}
    </div>
  );
}

function SupplierOrders({ supplier, orders, canCreateOrder, onNewOrder }: { supplier: Supplier; orders: readonly PurchaseOrder[]; canCreateOrder: boolean; onNewOrder: () => void }) {
  const own = orders.filter((order) => order.supplier_id === supplier.id);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Pedidos de compra</h3>
        {canCreateOrder && (
          <button type="button" className={PRIMARY} onClick={onNewOrder}>
            <Truck size={14} aria-hidden="true" /> Novo pedido
          </button>
        )}
      </div>
      {own.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum pedido de compra deste fornecedor.</p> : (
        <>
          <p className="text-xs text-muted-foreground">
            {own.length} pedido(s), {formatCurrency(sumMoney(own.filter((order) => order.status !== "cancelado").map((order) => Number(order.total))))} fora os cancelados.
          </p>
          <ul className="divide-y rounded-lg border">
            {own.slice(0, 8).map((order) => (
              <li key={order.id}>
                <Link to={`/purchasing/pedidos/${order.id}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-muted/30">
                  <span className="font-medium">{formatSequence("purchase_orders", order.number)}</span>
                  <span className="text-muted-foreground">{formatDay(order.order_date)}</span>
                  <StatusBadge status={order.status} />
                  <span className="tabular-nums">{formatCurrency(Number(order.total))}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
