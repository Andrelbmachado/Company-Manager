import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CrudDialog, type CrudField } from "@/components/shared/CrudDialog";
import { getDb } from "@/lib/db/client";
import { saveContact } from "@/lib/crm/queries";
import type { Contact } from "@/types";
import { errorText } from "./Modal";
import { useAudit, useCrmSession, useCustomers, useInvalidateCrm } from "./useCrm";

interface ContactFormDialogProps {
  contact?: Contact | null;
  /** Cliente fixo (ficha do cliente): sem o campo de cliente. */
  customerId?: string | null;
  onClose: () => void;
  onSaved?: (id: string) => void;
}

export function ContactFormDialog({ contact, customerId, onClose, onSaved }: ContactFormDialogProps) {
  const { companyId } = useCrmSession();
  const invalidate = useInvalidateCrm();
  const audit = useAudit();
  const fixedCustomer = customerId !== undefined;
  const { data: customers = [] } = useCustomers(!fixedCustomer);
  const [values, setValues] = useState<Record<string, string>>(() => ({
    name: contact?.name ?? "",
    role: contact?.role ?? "",
    email: contact?.email ?? "",
    phone: contact?.phone ?? "",
    whatsapp: contact?.whatsapp ?? "",
    customer_id: contact?.customer_id ?? customerId ?? "",
    notes: contact?.notes ?? "",
  }));

  const mutation = useMutation({
    mutationFn: async () => {
      const id = await saveContact(
        await getDb(),
        companyId,
        { name: values.name ?? "", role: values.role, email: values.email, phone: values.phone, whatsapp: values.whatsapp, notes: values.notes, customer_id: fixedCustomer ? customerId ?? null : values.customer_id || null },
        contact?.id,
      );
      await audit(contact ? "contact.updated" : "contact.created", "contact", id, `${contact ? "Contato editado" : "Contato criado"}: ${values.name.trim()}`, { newValue: values });
      return id;
    },
    onSuccess: (id) => {
      invalidate("contacts", "customers");
      onSaved?.(id);
      onClose();
    },
  });

  const fields: CrudField[] = [
    { key: "name", label: "Nome", required: true },
    { key: "role", label: "Cargo / função" },
    { key: "email", label: "E-mail", type: "email" },
    { key: "phone", label: "Telefone" },
    { key: "whatsapp", label: "WhatsApp" },
    ...(fixedCustomer ? [] : [{ key: "customer_id", label: "Cliente", type: "select" as const, options: [{ value: "", label: "Sem cliente" }, ...customers.map((customer) => ({ value: customer.id, label: customer.name }))] }]),
    { key: "notes", label: "Observações", type: "textarea" },
  ];

  return (
    <CrudDialog
      title={contact ? "Editar contato" : "Novo contato"}
      fields={fields}
      values={values}
      onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
      onClose={onClose}
      onSubmit={() => mutation.mutate()}
      busy={mutation.isPending}
    >
      {mutation.error && <p role="alert" className="mt-4 text-sm text-destructive">{errorText(mutation.error)}</p>}
    </CrudDialog>
  );
}
