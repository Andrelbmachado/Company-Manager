// Contatos numa tabela editável (lista geral e aba Contatos da ficha). Editar muda nome, cargo, e-mail, telefones e o
// contato principal; Adicionar cadastra na própria tabela (na ficha, já ligado ao cliente). Permissão: customers.
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Star, Trash2 } from "lucide-react";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { saveContactRows } from "@/lib/commercial/crmEdits";
import { confirmAction } from "@/lib/confirm";
import { getDb } from "@/lib/db/client";
import { deleteContact } from "@/lib/crm/queries";
import { ROW_DANGER, refreshQueries, useEditActor } from "@/modules/catalog/components/inline";
import type { Contact } from "@/types";
import { errorText } from "./Modal";
import { LINK } from "./ui";
import { useAudit, useCrmSession, useCustomerMap, useInvalidateCrm } from "./useCrm";

interface ContactsTableProps {
  contacts: Contact[];
  loading?: boolean;
  /** Cliente fixo (ficha): sem a coluna Cliente e as linhas novas já vêm ligadas a ele. */
  customerId?: string;
  title?: string;
  emptyMessage?: string;
}

export function ContactsTable({ contacts, loading, customerId, title = "Contatos", emptyMessage }: ContactsTableProps) {
  const { companyId, can } = useCrmSession();
  const actor = useEditActor();
  const qc = useQueryClient();
  const invalidate = useInvalidateCrm();
  const audit = useAudit();
  const { data: customerList = [], map: customers } = useCustomerMap();
  const remove = useMutation({
    mutationFn: async (contact: Contact) => {
      await deleteContact(await getDb(), companyId, contact.id);
      await audit("contact.deleted", "contact", contact.id, `Contato excluído: ${contact.name}`);
    },
    onSuccess: () => invalidate("contacts"),
  });

  const customerColumn: EditableColumn<Contact> = {
    key: "customer_id",
    header: "Cliente",
    kind: "select",
    width: 200,
    options: customerList.map((customer) => ({ value: customer.id, label: customer.name })),
    render: (contact) => {
      const customer = contact.customer_id ? customers.get(contact.customer_id) : null;
      return customer ? <Link to={`/crm/clientes/${customer.id}?aba=contatos`} className={LINK}>{customer.name}</Link> : <span className="text-muted-foreground">—</span>;
    },
  };
  const columns: EditableColumn<Contact>[] = [
    {
      key: "name",
      header: "Nome",
      kind: "text",
      required: true,
      width: 200,
      render: (contact) => (
        <span className="flex items-center gap-1.5 font-medium">
          {Number(contact.is_primary) === 1 && <Star size={13} className="fill-current text-status-warning" aria-label="Contato principal" />}
          {contact.name}
        </span>
      ),
    },
    ...(customerId ? [] : [customerColumn]),
    { key: "role", header: "Cargo", kind: "text" },
    { key: "email", header: "E-mail", kind: "email", render: (contact) => (contact.email ? <a href={`mailto:${contact.email}`} className={LINK}>{contact.email}</a> : <span className="text-muted-foreground">—</span>) },
    { key: "phone", header: "Telefone", kind: "phone" },
    { key: "whatsapp", header: "WhatsApp", kind: "phone" },
    { key: "is_primary", header: "Principal", kind: "bool" },
    { key: "notes", header: "Observações", kind: "text" },
  ];

  async function save(changes: EditableTableChanges<Contact>) {
    const result = await saveContactRows(await getDb(), companyId, actor, changes, { customerId });
    const names = new Map(contacts.map((contact) => [contact.id, contact.name]));
    for (const id of result.updated) await audit("contact.updated", "contact", id, `Contato editado: ${names.get(id) ?? ""}`);
    for (const [index, id] of result.created.entries()) await audit("contact.created", "contact", id, `Contato criado: ${changes.created[index]?.name ?? ""}`);
    invalidate("contacts", "customers");
  }

  return (
    <div className="space-y-2">
      {remove.error && <p role="alert" className="text-sm text-destructive">{errorText(remove.error)}</p>}
      <EditableTable<Contact>
        resource="customers"
        title={title}
        label={title}
        rows={contacts}
        columns={columns}
        loading={loading}
        onSave={save}
        onRefresh={() => refreshQueries(qc, ["contacts", "customers"])}
        newRow={() => (customerId ? { customer_id: customerId } : {})}
        emptyMessage={emptyMessage ?? "Nenhum contato"}
        rowActions={
          can("edit", "customers")
            ? (contact) => (
                <button
                  type="button"
                  className={ROW_DANGER}
                  disabled={remove.isPending}
                  aria-label={`Excluir ${contact.name}`}
                  onClick={async () => {
                    if (await confirmAction(`Excluir ${contact.name}?`, { title: "Excluir contato", okLabel: "Excluir" })) remove.mutate(contact);
                  }}
                >
                  <Trash2 size={13} />
                </button>
              )
            : undefined
        }
      />
    </div>
  );
}
