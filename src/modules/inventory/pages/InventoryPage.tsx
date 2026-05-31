import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getDb } from "@/lib/db/client";
import { useRequiredSession } from "@/hooks/useSession";
import { usePermission } from "@/hooks/usePermission";
import { emit } from "@/lib/events/bus";
import { PageHeader } from "@/components/shared/PageHeader";
import { CrudDialog } from "@/components/shared/CrudDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { Package, Plus, AlertTriangle, Building2, Mail, Phone, Star, X, Pencil } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import type { InventoryItem } from "@/types";

interface ItemWithBalance extends InventoryItem {
  quantity: number;
  supplier_name?: string | null;
  supplier_document?: string | null;
  supplier_email?: string | null;
  supplier_phone?: string | null;
  supplier_terms?: string | null;
  supplier_rating?: number | null;
}

interface ItemCustody {
  id: string;
  item_id?: string | null;
  holder_name?: string | null;
  quantity: number;
  status: string;
  checked_out_at: string;
  due_back_at?: string | null;
}
interface SupplierOption { id: string; name: string; }

export default function InventoryPage() {
  const session = useRequiredSession();
  const qc = useQueryClient();
  const canCreateItem = usePermission("create", "inventory");
  const canEditItem = usePermission("edit", "inventory");
  const [showForm, setShowForm] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ItemWithBalance | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", sku: "", category: "", supplier_id: "", unit: "un", min_stock: "0", cost: "0" });

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["inventory", session.company.id],
    queryFn: async () => {
      const db = await getDb();
      return db.select<ItemWithBalance[]>(
        `SELECT i.*, s.name as supplier_name, s.document as supplier_document,
                s.email as supplier_email, s.phone as supplier_phone,
                s.terms as supplier_terms, s.rating as supplier_rating,
                COALESCE(SUM(b.quantity), 0) as quantity
         FROM inventory_items i
         LEFT JOIN stock_balances b ON b.item_id = i.id AND b.company_id = i.company_id
         LEFT JOIN suppliers s ON s.id = i.supplier_id
         WHERE i.company_id=? AND i.deleted_at IS NULL
         GROUP BY i.id
         ORDER BY i.name`,
        [session.company.id]
      );
    },
  });
  const { data: suppliers = [] } = useQuery({
    queryKey: ["supplier-options", session.company.id],
    queryFn: async () => (await getDb()).select<SupplierOption[]>("SELECT * FROM suppliers WHERE company_id=? AND deleted_at IS NULL ORDER BY name", [session.company.id]),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedItem) return;
      const db = await getDb();
      await db.execute(
        "UPDATE inventory_items SET name=?, sku=?, category=?, supplier_id=?, unit=?, min_stock=?, cost=?, updated_at=datetime('now') WHERE id=?",
        [form.name, form.sku || null, form.category || null, form.supplier_id || null, form.unit, parseFloat(form.min_stock) || 0, parseFloat(form.cost) || 0, selectedItem.id]
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory", session.company.id] });
      setSelectedItem((item) => item ? { ...item, name: form.name, sku: form.sku, category: form.category, supplier_id: form.supplier_id, supplier_name: suppliers.find((supplier) => supplier.id === form.supplier_id)?.name, unit: form.unit, min_stock: Number(form.min_stock), cost: Number(form.cost) } : null);
      setEditing(false);
    },
  });

  const { data: custodies = [] } = useQuery({
    queryKey: ["inventory-custodies", session.company.id],
    queryFn: async () => {
      const db = await getDb();
      return db.select<ItemCustody[]>(
        `SELECT c.*, u.name as holder_name
         FROM custodies c
         LEFT JOIN users u ON u.id = c.holder_id
         WHERE c.company_id=? AND c.deleted_at IS NULL
         ORDER BY c.checked_out_at DESC`,
        [session.company.id]
      );
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const db = await getDb();
      const id = uuidv4();
      await db.execute(
        "INSERT INTO inventory_items (id, company_id, name, sku, category, supplier_id, unit, min_stock, cost) VALUES (?,?,?,?,?,?,?,?,?)",
        [
          id, session.company.id, form.name,
          form.sku || null, form.category || null, form.supplier_id || null, form.unit,
          parseFloat(form.min_stock) || 0, parseFloat(form.cost) || 0,
        ]
      );
      await emit({
        type: "stock.item_created",
        companyId: session.company.id,
        actorId: session.user.id,
        entityType: "inventory_item",
        entityId: id,
        title: `Item criado: ${form.name}`,
        module: "inventory",
        newValue: form,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory", session.company.id] });
      setShowForm(false);
      setForm({ name: "", sku: "", category: "", supplier_id: "", unit: "un", min_stock: "0", cost: "0" });
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Estoque"
        description="Itens, saldos e movimentações"
        actions={canCreateItem ? (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus size={14} />
            Novo item
          </button>
        ) : undefined}
      />

      {showForm && (
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <h3 className="font-semibold">Novo item</h3>
          <div className="grid grid-cols-2 gap-4">
            {[
              { key: "name", label: "Nome *", placeholder: "Cabo de rede Cat6" },
              { key: "sku", label: "SKU", placeholder: "CAB-CAT6-01" },
              { key: "category", label: "Categoria", placeholder: "Cabos" },
              { key: "unit", label: "Unidade", placeholder: "un" },
              { key: "min_stock", label: "Estoque mínimo", placeholder: "5" },
              { key: "cost", label: "Custo (R$)", placeholder: "0.00" },
            ].map(({ key, label, placeholder }) => (
              <div key={key} className="space-y-1.5">
                <label className="text-sm font-medium">{label}</label>
                <input
                  value={form[key as keyof typeof form]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="flex h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  placeholder={placeholder}
                />
              </div>
            ))}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Fornecedor</label>
              <select value={form.supplier_id} onChange={(event) => setForm((current) => ({ ...current, supplier_id: event.target.value }))} className="flex h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring">
                <option value="">Nao informado</option>
                {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="rounded-md border px-4 py-1.5 text-sm hover:bg-muted transition-colors">
              Cancelar
            </button>
            <button
              onClick={() => createMutation.mutate()}
              disabled={!form.name || createMutation.isPending}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              Salvar
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 rounded-lg bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={Package} title="Nenhum item no estoque" />
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Item</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">SKU</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Categoria</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Fornecedor</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Saldo</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Mínimo</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Custo unit.</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((item) => {
                const belowMin = item.quantity < item.min_stock;
                return (
                  <tr key={item.id} onClick={() => setSelectedItem(item)} className="cursor-pointer hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {belowMin && <AlertTriangle size={14} className="text-red-500 shrink-0" />}
                        <span className="font-medium">{item.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{item.sku ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{item.category ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{item.supplier_name ?? "—"}</td>
                    <td className={`px-4 py-3 font-medium ${belowMin ? "text-red-500" : ""}`}>
                      {item.quantity} {item.unit}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{item.min_stock} {item.unit}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatCurrency(item.cost)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedItem && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onClick={() => setSelectedItem(null)}>
          <aside className="h-full w-full max-w-xl overflow-y-auto bg-background p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 border-b pb-5">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{selectedItem.sku}</p>
                <h2 className="mt-1 text-xl font-semibold">{selectedItem.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{selectedItem.category} · {selectedItem.unit}</p>
              </div>
              <div className="flex gap-1">
                {canEditItem && <button onClick={() => {
                  setForm({ name: selectedItem.name, sku: selectedItem.sku ?? "", category: selectedItem.category ?? "", supplier_id: selectedItem.supplier_id ?? "", unit: selectedItem.unit, min_stock: String(selectedItem.min_stock), cost: String(selectedItem.cost) });
                  setEditing(true);
                }} className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"><Pencil size={14} /> Editar</button>}
                <button onClick={() => setSelectedItem(null)} className="rounded-md p-2 text-muted-foreground hover:bg-muted"><X size={17} /></button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 border-b py-5">
              <Metric label="Saldo atual" value={`${selectedItem.quantity} ${selectedItem.unit}`} alert={selectedItem.quantity < selectedItem.min_stock} />
              <Metric label="Estoque minimo" value={`${selectedItem.min_stock} ${selectedItem.unit}`} />
              <Metric label="Custo unitario" value={formatCurrency(selectedItem.cost)} />
            </div>

            <section className="border-b py-5">
              <h3 className="text-sm font-semibold">Fornecedor</h3>
              <div className="mt-4 space-y-3">
                <Detail icon={Building2} value={selectedItem.supplier_name ?? "Nao informado"} />
                <Detail icon={Building2} value={selectedItem.supplier_document ?? "Documento nao informado"} />
                <Detail icon={Mail} value={selectedItem.supplier_email ?? "E-mail nao informado"} />
                <Detail icon={Phone} value={selectedItem.supplier_phone ?? "Telefone nao informado"} />
                <Detail icon={Star} value={`${selectedItem.supplier_rating ?? "—"}/5 · ${selectedItem.supplier_terms ?? "Condicao comercial nao informada"}`} />
              </div>
            </section>

            <section className="py-5">
              <h3 className="text-sm font-semibold">Historico de custodia</h3>
              <div className="mt-4 space-y-3">
                {custodies.filter((custody) => custody.item_id === selectedItem.id).length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma movimentacao de custodia para esta peca.</p>
                ) : custodies.filter((custody) => custody.item_id === selectedItem.id).map((custody) => (
                  <div key={custody.id} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium">{custody.holder_name ?? "Responsavel nao informado"}</p>
                      <StatusBadge status={custody.status} />
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {custody.quantity} {selectedItem.unit} · retirada em {formatDateTime(custody.checked_out_at)}
                    </p>
                    {custody.due_back_at && <p className="mt-1 text-xs text-muted-foreground">Devolucao prevista: {formatDateTime(custody.due_back_at)}</p>}
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      )}
      {editing && (
        <CrudDialog
          title="Editar item"
          fields={[
            { key: "name", label: "Nome", required: true },
            { key: "sku", label: "SKU" },
            { key: "category", label: "Categoria" },
            { key: "supplier_id", label: "Fornecedor", type: "select", options: [{ value: "", label: "Nao informado" }, ...suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))] },
            { key: "unit", label: "Unidade" },
            { key: "min_stock", label: "Estoque minimo", type: "number" },
            { key: "cost", label: "Custo unitario", type: "number" },
          ]}
          values={form}
          onChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))}
          onClose={() => setEditing(false)}
          onSubmit={() => updateMutation.mutate()}
          busy={updateMutation.isPending}
        />
      )}
    </div>
  );
}

function Metric({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-sm font-semibold ${alert ? "text-red-500" : ""}`}>{value}</p>
    </div>
  );
}

function Detail({ icon: Icon, value }: { icon: React.ElementType; value: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon size={14} className="shrink-0 text-muted-foreground" />
      <span>{value}</span>
    </div>
  );
}
