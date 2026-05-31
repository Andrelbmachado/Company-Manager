import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getDb } from "@/lib/db/client";
import { useRequiredSession } from "@/hooks/useSession";
import { usePermission } from "@/hooks/usePermission";
import { emit } from "@/lib/events/bus";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { CrudDialog } from "@/components/shared/CrudDialog";
import { DetailDrawer, DetailGrid, DetailItem } from "@/components/shared/DetailDrawer";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatDate } from "@/lib/utils";
import { Users, Plus } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import type { Customer } from "@/types";

async function fetchCustomers(companyId: string): Promise<Customer[]> {
  const db = await getDb();
  return db.select<Customer[]>(
    "SELECT * FROM customers WHERE company_id=? AND deleted_at IS NULL ORDER BY name",
    [companyId]
  );
}

export default function CrmPage() {
  const session = useRequiredSession();
  const qc = useQueryClient();
  const canCreateCustomer = usePermission("create", "customers");
  const canEditCustomer = usePermission("edit", "customers");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", type: "PJ", document: "" });

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ["customers", session.company.id],
    queryFn: () => fetchCustomers(session.company.id),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCustomer) return;
      const db = await getDb();
      await db.execute(
        "UPDATE customers SET type=?, name=?, email=?, phone=?, document=?, updated_at=datetime('now') WHERE id=?",
        [form.type, form.name, form.email || null, form.phone || null, form.document || null, selectedCustomer.id]
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers", session.company.id] });
      setSelectedCustomer((customer) => customer ? { ...customer, ...form, type: form.type as Customer["type"] } : null);
      setEditing(false);
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const db = await getDb();
      const id = uuidv4();
      await db.execute(
        "INSERT INTO customers (id, company_id, type, name, email, phone, document) VALUES (?,?,?,?,?,?,?)",
        [id, session.company.id, form.type, form.name, form.email || null, form.phone || null, form.document || null]
      );
      await emit({
        type: "customer.created",
        companyId: session.company.id,
        actorId: session.user.id,
        entityType: "customer",
        entityId: id,
        title: `Cliente criado: ${form.name}`,
        module: "crm",
        newValue: form,
      });
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers", session.company.id] });
      setShowForm(false);
      setForm({ name: "", email: "", phone: "", type: "PJ", document: "" });
    },
  });

  const filtered = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.email ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="CRM — Clientes"
        description="Gestão de clientes e contatos"
        actions={canCreateCustomer ? (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus size={14} />
            Novo cliente
          </button>
        ) : undefined}
      />

      <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar clientes..." />

      {/* New customer form */}
      {showForm && (
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <h3 className="font-semibold">Novo cliente</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1.5">
              <label className="text-sm font-medium">Nome *</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="flex h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="Empresa XYZ Ltda"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Tipo</label>
              <select
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                className="flex h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="PJ">Pessoa Jurídica</option>
                <option value="PF">Pessoa Física</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">CNPJ/CPF</label>
              <input
                value={form.document}
                onChange={(e) => setForm((f) => ({ ...f, document: e.target.value }))}
                className="flex h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="00.000.000/0001-00"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">E-mail</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="flex h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="contato@empresa.com"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Telefone</label>
              <input
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="flex h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="(11) 99999-9999"
              />
            </div>
          </div>
          {createMutation.error && (
            <p className="text-sm text-destructive">{String(createMutation.error)}</p>
          )}
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setShowForm(false)}
              className="rounded-md border px-4 py-1.5 text-sm hover:bg-muted transition-colors"
            >
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

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 rounded-lg bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nenhum cliente cadastrado"
          description="Clique em 'Novo cliente' para começar."
        />
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Nome</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Tipo</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">E-mail</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Telefone</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Cadastro</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((c) => (
                <tr key={c.id} onClick={() => setSelectedCustomer(c)} className="cursor-pointer hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.type}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.email ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.phone ?? "—"}</td>
                  <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedCustomer && (
        <DetailDrawer title={selectedCustomer.name} subtitle="Cliente" onClose={() => setSelectedCustomer(null)} onEdit={canEditCustomer ? () => {
          setForm({ name: selectedCustomer.name, email: selectedCustomer.email ?? "", phone: selectedCustomer.phone ?? "", type: selectedCustomer.type, document: selectedCustomer.document ?? "" });
          setEditing(true);
        } : undefined}>
          <DetailGrid>
            <DetailItem label="Tipo" value={selectedCustomer.type} />
            <DetailItem label="Documento" value={selectedCustomer.document} />
            <DetailItem label="E-mail" value={selectedCustomer.email} />
            <DetailItem label="Telefone" value={selectedCustomer.phone} />
            <DetailItem label="Status" value={<StatusBadge status={selectedCustomer.status} />} />
            <DetailItem label="Cadastro" value={formatDate(selectedCustomer.created_at)} />
          </DetailGrid>
        </DetailDrawer>
      )}
      {editing && (
        <CrudDialog
          title="Editar cliente"
          fields={[
            { key: "name", label: "Nome", required: true },
            { key: "type", label: "Tipo", type: "select", options: [{ value: "PJ", label: "Pessoa Juridica" }, { value: "PF", label: "Pessoa Fisica" }] },
            { key: "document", label: "CNPJ / CPF" },
            { key: "email", label: "E-mail", type: "email" },
            { key: "phone", label: "Telefone" },
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
