import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Contact as ContactIcon, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { ImportExportButtons } from "@/components/shared/ImportExportButtons";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { getDb } from "@/lib/db/client";
import { deleteContact, fold } from "@/lib/crm/queries";
import { cn } from "@/lib/utils";
import type { Contact } from "@/types";
import { ContactFormDialog } from "../components/ContactFormDialog";
import { ConfirmDialog, errorText } from "../components/Modal";
import { BTN_GHOST, BTN_PRIMARY, CARD, LINK, SELECT, TD, TH } from "../components/ui";
import { useAudit, useContacts, useCrmSession, useCustomerMap, useInvalidateCrm } from "../components/useCrm";

/** Contatos de todos os clientes: busca, cadastro e edição. */
export default function ContactsPage() {
  const { companyId, can } = useCrmSession();
  const invalidate = useInvalidateCrm();
  const audit = useAudit();
  const { data: contacts = [], isLoading } = useContacts();
  const { map: customers } = useCustomerMap();
  const [search, setSearch] = useState("");
  const [link, setLink] = useState<"" | "com" | "sem">("");
  const [editing, setEditing] = useState<Contact | "new" | null>(null);
  const [removing, setRemoving] = useState<Contact | null>(null);
  const canEdit = can("edit", "customers");

  const filtered = useMemo(() => {
    const term = fold(search.trim());
    const digits = search.replace(/\D/g, "");
    return contacts.filter((contact) => {
      if (link === "com" && !contact.customer_id) return false;
      if (link === "sem" && contact.customer_id) return false;
      if (!term) return true;
      const customer = contact.customer_id ? customers.get(contact.customer_id)?.name : null;
      if ([contact.name, contact.email, contact.role, customer].some((field) => fold(field).includes(term))) return true;
      return digits.length >= 3 && [contact.phone, contact.whatsapp].some((field) => (field ?? "").replace(/\D/g, "").includes(digits));
    });
  }, [contacts, customers, search, link]);

  const remove = useMutation({
    mutationFn: async (contact: Contact) => {
      await deleteContact(await getDb(), companyId, contact.id);
      await audit("contact.deleted", "contact", contact.id, `Contato excluído: ${contact.name}`);
    },
    onSuccess: () => {
      invalidate("contacts");
      setRemoving(null);
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contatos"
        description="Pessoas com quem você fala em cada cliente"
        actions={
          <>
            <ImportExportButtons entity="contacts" onImported={() => invalidate("contacts")} />
            {canEdit && <button type="button" onClick={() => setEditing("new")} className={BTN_PRIMARY}><Plus size={14} /> Novo contato</button>}
          </>
        }
      />
      <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar por nome, e-mail, telefone, cliente...">
        <select value={link} onChange={(event) => setLink(event.target.value as "" | "com" | "sem")} aria-label="Filtrar por cliente" className={SELECT}>
          <option value="">Todos</option>
          <option value="com">Com cliente</option>
          <option value="sem">Sem cliente</option>
        </select>
      </PageToolbar>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-12 animate-pulse rounded-lg bg-muted/30" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={ContactIcon} title={contacts.length ? "Nenhum contato encontrado" : "Nenhum contato cadastrado"} description={contacts.length ? "Ajuste a busca." : "Cadastre aqui ou na ficha de cada cliente."} />
      ) : (
        <div className={cn(CARD, "overflow-x-auto")}>
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className={TH}>Nome</th>
                <th className={TH}>Cliente</th>
                <th className={TH}>Cargo</th>
                <th className={TH}>E-mail</th>
                <th className={TH}>Telefone</th>
                <th className={TH}><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((contact) => {
                const customer = contact.customer_id ? customers.get(contact.customer_id) : null;
                return (
                  <tr key={contact.id}>
                    <td className={TD}>
                      <span className="flex items-center gap-1.5 font-medium">
                        {Number(contact.is_primary) === 1 && <Star size={13} className="fill-current text-status-warning" aria-label="Contato principal" />}
                        {contact.name}
                      </span>
                    </td>
                    <td className={TD}>{customer ? <Link to={`/crm/clientes/${customer.id}?aba=contatos`} className={LINK}>{customer.name}</Link> : <span className="text-muted-foreground">—</span>}</td>
                    <td className={cn(TD, "text-muted-foreground")}>{contact.role ?? "—"}</td>
                    <td className={cn(TD, "text-muted-foreground")}>{contact.email ? <a href={`mailto:${contact.email}`} className={LINK}>{contact.email}</a> : "—"}</td>
                    <td className={cn(TD, "whitespace-nowrap text-muted-foreground")}>{contact.phone ?? contact.whatsapp ?? "—"}</td>
                    <td className={cn(TD, "whitespace-nowrap text-right")}>
                      {canEdit && <button type="button" onClick={() => setEditing(contact)} className={BTN_GHOST} aria-label={`Editar ${contact.name}`}><Pencil size={12} /></button>}
                      {canEdit && <button type="button" onClick={() => setRemoving(contact)} className={BTN_GHOST} aria-label={`Excluir ${contact.name}`}><Trash2 size={12} /></button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && <ContactFormDialog contact={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {removing && (
        <ConfirmDialog
          title="Excluir contato"
          message={`Excluir ${removing.name}?`}
          confirmLabel="Excluir"
          danger
          busy={remove.isPending}
          error={errorText(remove.error)}
          onConfirm={() => remove.mutate(removing)}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
