// Fornecedores editados direto na tabela (Editar / Adicionar / Atualizar), com as mesmas regras do cadastro (CNPJ/CPF
// único, e-mail, avaliação 1 a 5). A ficha abre abaixo da tabela, sem modal: dados complementares (também editáveis na
// tabela), pedidos de compra e exclusão (com confirmação; bloqueada com pedido em andamento).
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { FileText, Star, Trash2, Truck, X } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { ImportExportButtons } from "@/components/shared/ImportExportButtons";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { usePermission } from "@/hooks/usePermission";
import { useRequiredSession } from "@/hooks/useSession";
import { confirmAction } from "@/lib/confirm";
import { getDb } from "@/lib/db/client";
import { formatSequence } from "@/lib/db/sequence";
import { deleteSupplierRow, saveSupplierRows, toSupplierTableRows, type SupplierTableRow } from "@/lib/erp/supplierRows";
import { useLabel } from "@/lib/labels/useLabel";
import { sumMoney } from "@/lib/money";
import { formatCurrency, formatDay } from "@/lib/utils";
import { DANGER, PRIMARY, invalidateTrade, usePurchaseOrders, useSuppliers } from "@/modules/catalog/components/tradeKit";
import { emitSafely, ErrorBanner, useActor } from "@/modules/inventory/components/inventoryUi";

const RATING_OPTIONS = [1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: `${value} de 5` }));

function Rating({ value }: { value: number | null | undefined }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} de 5`} title={`${value} de 5`}>
      {[1, 2, 3, 4, 5].map((star) => <Star key={star} size={13} className={star <= value ? "fill-current text-status-warning" : "text-muted-foreground/40"} aria-hidden="true" />)}
    </span>
  );
}

const errorText = (error: unknown) => (error instanceof Error && error.message ? error.message : "Não foi possível concluir a operação.");

export default function SuppliersPage() {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const title = useLabel("module.suppliers");
  const actor = useActor();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canDelete = usePermission("delete", "suppliers");
  const canCreateOrder = usePermission("create", "purchase_orders");
  const canSeeOrders = usePermission("view", "purchase_orders");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const suppliersQuery = useSuppliers(companyId);
  const { data: orders = [] } = usePurchaseOrders(companyId, canSeeOrders);
  const rows = useMemo(() => toSupplierTableRows(suppliersQuery.data ?? [], orders), [suppliersQuery.data, orders]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    const digits = term.replace(/\D/g, "");
    return rows.filter(
      (supplier) =>
        [supplier.name, supplier.trade_name, supplier.email, supplier.category, supplier.contact_name, supplier.cidade].some((value) => value?.toLowerCase().includes(term)) ||
        (digits.length >= 3 && (supplier.document ?? "").replace(/\D/g, "").includes(digits)),
    );
  }, [rows, search]);

  const selected = rows.find((supplier) => supplier.id === selectedId) ?? null;
  const selectedOrders = selected ? orders.filter((order) => order.supplier_id === selected.id) : [];

  const columns: EditableColumn<SupplierTableRow>[] = [
    { key: "name", header: "Razão social / nome", kind: "text", required: true, render: (row) => <span className="font-medium">{row.name}</span> },
    { key: "trade_name", header: "Nome fantasia", kind: "text" },
    { key: "document", header: "CNPJ / CPF", kind: "text", placeholder: "00.000.000/0001-00" },
    { key: "contact_name", header: "Contato", kind: "text" },
    { key: "email", header: "E-mail", kind: "email" },
    { key: "phone", header: "Telefone", kind: "phone" },
    { key: "category", header: "Categoria", kind: "text", placeholder: "Ex.: Eletrônicos" },
    { key: "terms", header: "Condição", kind: "text", placeholder: "Ex.: 28 dias" },
    { key: "rating", header: "Avaliação", kind: "select", options: RATING_OPTIONS, render: (row) => <Rating value={row.rating} /> },
    { key: "cidade", header: "Cidade", kind: "text" },
    { key: "uf", header: "UF", kind: "text", width: 70 },
    ...(canSeeOrders ? [{ key: "open_orders" as const, header: "Pedidos em aberto", kind: "number" as const, readOnly: true, render: (row: SupplierTableRow) => row.open_orders || "—" }] : []),
  ];

  const detailColumns: EditableColumn<SupplierTableRow>[] = [
    { key: "state_registration", header: "Inscrição estadual", kind: "text" },
    { key: "website", header: "Site", kind: "text" },
    { key: "logradouro", header: "Logradouro", kind: "text" },
    { key: "numero", header: "Número", kind: "text", width: 90 },
    { key: "complemento", header: "Complemento", kind: "text" },
    { key: "bairro", header: "Bairro", kind: "text" },
    { key: "cep", header: "CEP", kind: "text", width: 110 },
    { key: "notes", header: "Observações", kind: "text" },
  ];

  async function refresh() {
    invalidateTrade(qc);
    void qc.invalidateQueries({ queryKey: ["supplier-options"] });
    await suppliersQuery.refetch();
  }

  async function save(changes: EditableTableChanges<SupplierTableRow>) {
    const result = await saveSupplierRows(await getDb(), companyId, actor, changes);
    invalidateTrade(qc);
    void qc.invalidateQueries({ queryKey: ["supplier-options"] });
    const nameOf = (id: string) => String(changes.created.find((row) => row.id === id)?.name ?? rows.find((row) => row.id === id)?.name ?? "").trim();
    await emitSafely([
      ...result.created.map((id) => ({ type: "supplier.created", companyId, actorId: actor.userId, entityType: "supplier", entityId: id, title: `Fornecedor cadastrado: ${nameOf(id)}`, module: "purchasing" })),
      ...result.updated.map((id) => ({ type: "supplier.updated", companyId, actorId: actor.userId, entityType: "supplier", entityId: id, title: `Fornecedor atualizado: ${nameOf(id)}`, module: "purchasing" })),
    ]);
  }

  async function remove(supplier: SupplierTableRow) {
    setError(null);
    const ok = await confirmAction(
      `Excluir "${supplier.name}"? Ele sai da lista de fornecedores; nos pedidos e recebimentos antigos aparece como "Fornecedor removido". Não dá para excluir com pedido de compra em andamento.`,
      { title: "Excluir fornecedor", okLabel: "Excluir" },
    );
    if (!ok) return;
    try {
      await deleteSupplierRow(await getDb(), companyId, actor, supplier.id);
      await emitSafely([{ type: "supplier.deleted", companyId, actorId: actor.userId, entityType: "supplier", entityId: supplier.id, title: `Fornecedor excluído: ${supplier.name}`, module: "purchasing" }]);
      setSelectedId(null);
      await refresh();
    } catch (caught) {
      setError(errorText(caught));
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={title}
        description="Cadastro de fornecedores de produtos e serviços, com documento, contato e condição de pagamento."
        actions={<ImportExportButtons entity="suppliers" onImported={() => invalidateTrade(qc)} />}
      />
      <ErrorBanner message={error} onClose={() => setError(null)} />
      <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar por nome, CNPJ, categoria..." />

      <EditableTable
        resource="suppliers"
        label="Fornecedores"
        title="Fornecedores"
        rows={filtered}
        columns={columns}
        loading={suppliersQuery.isLoading}
        onSave={save}
        onRefresh={refresh}
        newRow={() => ({ id: uuidv4() })}
        emptyMessage={rows.length ? "Nenhum fornecedor encontrado." : "Nenhum fornecedor cadastrado. Use Adicionar para cadastrar os fornecedores dos pedidos de compra."}
        rowActions={(row) => (
          <button
            type="button"
            onClick={() => setSelectedId((current) => (current === row.id ? null : row.id))}
            aria-label={`Ficha de ${row.name}`}
            aria-expanded={selectedId === row.id}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <FileText size={13} /> Ficha
          </button>
        )}
      />

      {selected && (
        <section aria-label={`Ficha de ${selected.name}`} className="space-y-5 rounded-xl border bg-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">{selected.name}</h2>
              <p className="text-sm text-muted-foreground">{[selected.trade_name, selected.document, selected.email].filter(Boolean).join(" · ") || "Fornecedor"}</p>
            </div>
            <button type="button" onClick={() => setSelectedId(null)} aria-label="Fechar ficha" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted">
              <X size={16} />
            </button>
          </div>

          <EditableTable resource="suppliers" label={`Dados complementares de ${selected.name}`} title="Endereço e dados complementares" rows={[selected]} columns={detailColumns} onSave={save} onRefresh={refresh} />

          {canSeeOrders && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Pedidos de compra</h3>
                {canCreateOrder && (
                  <button type="button" className={PRIMARY} onClick={() => navigate(`/purchasing/pedidos/nova?fornecedor=${encodeURIComponent(selected.id)}`)}>
                    <Truck size={14} /> Novo pedido
                  </button>
                )}
              </div>
              {selectedOrders.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum pedido de compra deste fornecedor.</p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    {selectedOrders.length} pedido(s), {formatCurrency(sumMoney(selectedOrders.filter((order) => order.status !== "cancelado").map((order) => Number(order.total))))} fora os cancelados.
                  </p>
                  <ul className="divide-y rounded-lg border">
                    {selectedOrders.slice(0, 8).map((order) => (
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
          )}

          {canDelete && (
            <div className="border-t pt-4">
              <button type="button" className={DANGER} onClick={() => void remove(selected)}>
                <Trash2 size={14} /> Excluir fornecedor
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
