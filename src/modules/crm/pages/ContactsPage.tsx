import { useMemo, useState } from "react";
import { ImportExportButtons } from "@/components/shared/ImportExportButtons";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { fold } from "@/lib/crm/queries";
import { ContactsTable } from "../components/ContactsTable";
import { SELECT } from "../components/ui";
import { useContacts, useCustomerMap, useInvalidateCrm } from "../components/useCrm";

/** Contatos de todos os clientes: busca e edição direto na tabela (Adicionar cadastra; Editar altera no lugar). */
export default function ContactsPage() {
  const invalidate = useInvalidateCrm();
  const { data: contacts = [], isLoading } = useContacts();
  const { map: customers } = useCustomerMap();
  const [search, setSearch] = useState("");
  const [link, setLink] = useState<"" | "com" | "sem">("");

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

  return (
    <div className="space-y-6">
      <PageHeader title="Contatos" actions={<ImportExportButtons entity="contacts" onImported={() => invalidate("contacts")} />} />
      <ContactsTable
        contacts={filtered}
        loading={isLoading}
        emptyMessage={contacts.length ? "Nenhum contato encontrado" : undefined}
        actions={
          <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar por nome, e-mail, telefone, cliente...">
            <select value={link} onChange={(event) => setLink(event.target.value as "" | "com" | "sem")} aria-label="Filtrar por cliente" className={SELECT}>
              <option value="">Todos</option>
              <option value="com">Com cliente</option>
              <option value="sem">Sem cliente</option>
            </select>
          </PageToolbar>
        }
      />
    </div>
  );
}
