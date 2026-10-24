import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Factory, Plus, Star, Trash2, Truck } from "lucide-react";
import { CrudDialog, type CrudField } from "@/components/shared/CrudDialog";
import { DetailDrawer, DetailGrid, DetailItem } from "@/components/shared/DetailDrawer";
import { EmptyState } from "@/components/shared/EmptyState";
import { ImportExportButtons } from "@/components/shared/ImportExportButtons";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { usePermission } from "@/hooks/usePermission";
import { useRequiredSession } from "@/hooks/useSession";
import { getDb } from "@/lib/db/client";
import { formatSequence } from "@/lib/db/sequence";
import { ADDRESS_FIELDS, deleteSupplier, formatAddress, saveSupplier, supplierAddress, type SupplierAddress } from "@/lib/erp/suppliers";
import { emit } from "@/lib/events/bus";
import { sumMoney } from "@/lib/money";
import { formatCurrency, formatDay } from "@/lib/utils";
import { DANGER, ErrorNote, LoadingRows, PRIMARY, TD, TH, invalidateTrade, num, usePurchaseOrders, useSuppliers } from "@/modules/catalog/components/tradeKit";
import type { Supplier } from "@/types";

const EMPTY_FORM: Record<string, string> = {
  name: "", tradeName: "", document: "", email: "", phone: "", contactName: "", category: "", terms: "", rating: "", website: "", stateRegistration: "", notes: "",
  logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "", cep: "",
};

const ADDRESS_LABELS: Record<keyof SupplierAddress, string> = {
  logradouro: "Logradouro", numero: "Número", complemento: "Complemento", bairro: "Bairro", cidade: "Cidade", uf: "UF", cep: "CEP",
};

const FIELDS: CrudField[] = [
  { key: "name", label: "Razão social / nome", required: true },
  { key: "tradeName", label: "Nome fantasia" },
  { key: "document", label: "CNPJ / CPF", placeholder: "00.000.000/0001-00" },
  { key: "stateRegistration", label: "Inscrição estadual" },
  { key: "contactName", label: "Contato" },
  { key: "email", label: "E-mail", type: "email" },
  { key: "phone", label: "Telefone" },
  { key: "website", label: "Site" },
  { key: "category", label: "Categoria", placeholder: "Ex.: Eletrônicos, Serviços" },
  { key: "terms", label: "Condição de pagamento", placeholder: "Ex.: 28 dias" },
  { key: "rating", label: "Avaliação", type: "select", options: [{ value: "", label: "Sem avaliação" }, ...[1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: `${value} de 5` }))] },
  ...ADDRESS_FIELDS.map((field) => ({ key: field, label: ADDRESS_LABELS[field] })),
  { key: "notes", label: "Observações", type: "textarea" },
];

const OPEN_PO = new Set(["rascunho", "aprovado", "enviado", "recebido_parcial"]);

function formFor(supplier: Supplier): Record<string, string> {
  const address = supplierAddress(supplier);
  return {
    ...EMPTY_FORM,
    name: supplier.name,
    tradeName: supplier.trade_name ?? "",
    document: supplier.document ?? "",
    email: supplier.email ?? "",
    phone: supplier.phone ?? "",
    contactName: supplier.contact_name ?? "",
    category: supplier.category ?? "",
    terms: supplier.terms ?? "",
    rating: supplier.rating ? String(supplier.rating) : "",
    website: supplier.website ?? "",
    stateRegistration: supplier.state_registration ?? "",
    notes: supplier.notes ?? "",
    ...Object.fromEntries(ADDRESS_FIELDS.map((field) => [field, address[field] ?? ""])),
  };
}

function Rating({ value }: { value: number | null | undefined }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} de 5`} title={`${value} de 5`}>
      {[1, 2, 3, 4, 5].map((star) => <Star key={star} size={13} className={star <= value ? "fill-current text-status-warning" : "text-muted-foreground/40"} aria-hidden="true" />)}
    </span>
  );
}

export default function SuppliersPage() {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canCreate = usePermission("create", "suppliers");
  const canEdit = usePermission("edit", "suppliers");
  const canDelete = usePermission("delete", "suppliers");
  const canCreateOrder = usePermission("create", "purchase_orders");
  const canSeeOrders = usePermission("view", "purchase_orders");
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<{ mode: "create" } | { mode: "edit"; supplier: Supplier } | null>(null);
  const [form, setForm] = useState<Record<string, string>>(EMPTY_FORM);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: suppliers = [], isLoading } = useSuppliers(companyId);
  const { data: orders = [] } = usePurchaseOrders(companyId, canSeeOrders);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return suppliers;
    const digits = term.replace(/\D/g, "");
    return suppliers.filter((supplier) =>
      [supplier.name, supplier.trade_name, supplier.email, supplier.category, supplier.contact_name].some((value) => value?.toLowerCase().includes(term)) ||
      (digits.length >= 3 && (supplier.document ?? "").replace(/\D/g, "").includes(digits)));
  }, [suppliers, search]);

  const selected = suppliers.find((supplier) => supplier.id === selectedId) ?? null;
  const selectedOrders = selected ? orders.filter((order) => order.supplier_id === selected.id) : [];

  const save = useMutation({
    mutationFn: async () => {
      const db = await getDb();
      const editing = dialog?.mode === "edit" ? dialog.supplier : null;
      const id = await saveSupplier(db, companyId, {
        name: form.name,
        tradeName: form.tradeName,
        document: form.document,
        email: form.email,
        phone: form.phone,
        contactName: form.contactName,
        category: form.category,
        terms: form.terms,
        rating: form.rating ? num(form.rating, Number.NaN) : null,
        website: form.website,
        stateRegistration: form.stateRegistration,
        notes: form.notes,
        address: Object.fromEntries(ADDRESS_FIELDS.map((field) => [field, form[field]])),
      }, editing?.id);
      await emit({ type: editing ? "supplier.updated" : "supplier.created", companyId, actorId: session.user.id, entityType: "supplier", entityId: id, title: `${editing ? "Fornecedor atualizado" : "Fornecedor cadastrado"}: ${form.name.trim()}`, module: "purchasing" });
      return id;
    },
    onSuccess: (id) => {
      invalidateTrade(qc);
      void qc.invalidateQueries({ queryKey: ["supplier-options"] });
      setDialog(null);
      setSelectedId(id);
    },
  });

  const remove = useMutation({
    mutationFn: async (supplier: Supplier) => {
      await deleteSupplier(await getDb(), companyId, supplier.id);
      await emit({ type: "supplier.deleted", companyId, actorId: session.user.id, entityType: "supplier", entityId: supplier.id, title: `Fornecedor excluído: ${supplier.name}`, module: "purchasing" });
    },
    onSuccess: () => {
      invalidateTrade(qc);
      void qc.invalidateQueries({ queryKey: ["supplier-options"] });
      setConfirmDelete(false);
      setSelectedId(null);
    },
  });

  function openCreate() {
    save.reset();
    setForm(EMPTY_FORM);
    setDialog({ mode: "create" });
  }

  function openEdit(supplier: Supplier) {
    save.reset();
    setForm(formFor(supplier));
    setDialog({ mode: "edit", supplier });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Fornecedores"
        description="Cadastro de fornecedores de produtos e serviços, com documento, contato e condição de pagamento."
        actions={
          <>
            <ImportExportButtons entity="suppliers" onImported={() => invalidateTrade(qc)} />
            {canCreate && <button type="button" onClick={openCreate} className={PRIMARY}><Plus size={14} /> Novo fornecedor</button>}
          </>
        }
      />
      <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar por nome, CNPJ, categoria..." />

      {isLoading ? <LoadingRows /> : filtered.length === 0 ? (
        <EmptyState icon={Factory} title={suppliers.length ? "Nenhum fornecedor encontrado" : "Nenhum fornecedor cadastrado"} description={suppliers.length ? "Tente outro termo de busca." : "Cadastre os fornecedores para usar nos pedidos de compra."} />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className={TH}>Fornecedor</th>
                <th className={TH}>CNPJ / CPF</th>
                <th className={TH}>Contato</th>
                <th className={TH}>Categoria</th>
                <th className={TH}>Condição</th>
                <th className={TH}>Avaliação</th>
                {canSeeOrders && <th className={`${TH} text-right`}>Pedidos em aberto</th>}
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((supplier) => {
                const open = orders.filter((order) => order.supplier_id === supplier.id && OPEN_PO.has(order.status)).length;
                return (
                  <tr key={supplier.id} className="cursor-pointer transition-colors hover:bg-muted/20" onClick={() => setSelectedId(supplier.id)}>
                    <td className={TD}>
                      <button type="button" className="text-left font-medium hover:underline" onClick={(event) => { event.stopPropagation(); setSelectedId(supplier.id); }}>{supplier.name}</button>
                      {supplier.trade_name && <p className="text-xs text-muted-foreground">{supplier.trade_name}</p>}
                    </td>
                    <td className={`${TD} tabular-nums text-muted-foreground`}>{supplier.document ?? "—"}</td>
                    <td className={`${TD} text-muted-foreground`}>
                      {supplier.contact_name ?? supplier.email ?? "—"}
                      {supplier.phone && <p className="text-xs">{supplier.phone}</p>}
                    </td>
                    <td className={`${TD} text-muted-foreground`}>{supplier.category ?? "—"}</td>
                    <td className={`${TD} text-muted-foreground`}>{supplier.terms ?? "—"}</td>
                    <td className={TD}><Rating value={supplier.rating} /></td>
                    {canSeeOrders && <td className={`${TD} text-right tabular-nums`}>{open || "—"}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <DetailDrawer title={selected.name} subtitle="Fornecedor" onClose={() => setSelectedId(null)} onEdit={canEdit ? () => openEdit(selected) : undefined}>
          <div className="space-y-6">
            <DetailGrid>
              <DetailItem label="Nome fantasia" value={selected.trade_name} />
              <DetailItem label="CNPJ / CPF" value={selected.document} />
              <DetailItem label="Inscrição estadual" value={selected.state_registration} />
              <DetailItem label="Categoria" value={selected.category} />
              <DetailItem label="Contato" value={selected.contact_name} />
              <DetailItem label="E-mail" value={selected.email ? <a className="hover:underline" href={`mailto:${selected.email}`}>{selected.email}</a> : null} />
              <DetailItem label="Telefone" value={selected.phone} />
              <DetailItem label="Site" value={selected.website} />
              <DetailItem label="Condição de pagamento" value={selected.terms} />
              <DetailItem label="Avaliação" value={<Rating value={selected.rating} />} />
            </DetailGrid>
            <DetailItem label="Endereço" value={formatAddress(supplierAddress(selected))} />
            {selected.notes && <DetailItem label="Observações" value={<p className="whitespace-pre-wrap">{selected.notes}</p>} />}

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
                {selectedOrders.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum pedido de compra deste fornecedor.</p> : (
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
                <button type="button" className={DANGER} onClick={() => { remove.reset(); setConfirmDelete(true); }}><Trash2 size={14} /> Excluir fornecedor</button>
              </div>
            )}
          </div>
        </DetailDrawer>
      )}

      {dialog && (
        <CrudDialog
          title={dialog.mode === "edit" ? "Editar fornecedor" : "Novo fornecedor"}
          fields={FIELDS}
          values={form}
          onChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))}
          onClose={() => setDialog(null)}
          onSubmit={() => save.mutate()}
          busy={save.isPending}
        >
          <ErrorNote error={save.error} className="mt-4" />
        </CrudDialog>
      )}

      {confirmDelete && selected && (
        <CrudDialog title="Excluir fornecedor?" fields={[]} values={{}} onChange={() => undefined} onClose={() => setConfirmDelete(false)} onSubmit={() => remove.mutate(selected)} busy={remove.isPending} submitLabel="Excluir">
          <p className="text-sm text-muted-foreground">"{selected.name}" sai da lista de fornecedores; nos pedidos e recebimentos antigos ele aparece como "Fornecedor removido". Não dá para excluir com pedido de compra em andamento.</p>
          <ErrorNote error={remove.error} className="mt-3" />
        </CrudDialog>
      )}
    </div>
  );
}
