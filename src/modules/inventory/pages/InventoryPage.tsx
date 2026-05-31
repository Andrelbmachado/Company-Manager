import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getDb } from "@/lib/db/client";
import { useRequiredSession } from "@/hooks/useSession";
import { emit } from "@/lib/events/bus";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { formatCurrency } from "@/lib/utils";
import { Package, Plus, AlertTriangle } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import type { InventoryItem } from "@/types";

interface ItemWithBalance extends InventoryItem {
  quantity: number;
}

export default function InventoryPage() {
  const session = useRequiredSession();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", sku: "", category: "", unit: "un", min_stock: "0", cost: "0" });

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["inventory", session.company.id],
    queryFn: async () => {
      const db = await getDb();
      return db.select<ItemWithBalance[]>(
        `SELECT i.*, COALESCE(SUM(b.quantity), 0) as quantity
         FROM inventory_items i
         LEFT JOIN stock_balances b ON b.item_id = i.id AND b.company_id = i.company_id
         WHERE i.company_id=? AND i.deleted_at IS NULL
         GROUP BY i.id
         ORDER BY i.name`,
        [session.company.id]
      );
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const db = await getDb();
      const id = uuidv4();
      await db.execute(
        "INSERT INTO inventory_items (id, company_id, name, sku, category, unit, min_stock, cost) VALUES (?,?,?,?,?,?,?,?)",
        [
          id, session.company.id, form.name,
          form.sku || null, form.category || null, form.unit,
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
      setForm({ name: "", sku: "", category: "", unit: "un", min_stock: "0", cost: "0" });
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Estoque"
        description="Itens, saldos e movimentações"
        actions={
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus size={14} />
            Novo item
          </button>
        }
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
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Saldo</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Mínimo</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Custo unit.</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((item) => {
                const belowMin = item.quantity < item.min_stock;
                return (
                  <tr key={item.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {belowMin && <AlertTriangle size={14} className="text-red-500 shrink-0" />}
                        <span className="font-medium">{item.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{item.sku ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{item.category ?? "—"}</td>
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
    </div>
  );
}
