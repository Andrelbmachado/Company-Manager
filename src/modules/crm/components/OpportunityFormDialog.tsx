import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CrudDialog, type CrudField } from "@/components/shared/CrudDialog";
import { getDb } from "@/lib/db/client";
import { OPEN_STAGES, saveOpportunity, STAGE_LABELS, STAGE_PROBABILITY, type Stage } from "@/lib/crm/queries";
import type { Opportunity } from "@/types";
import { moneyInput } from "./format";
import { errorText } from "./Modal";
import { useAudit, useCompanyUsers, useContacts, useCrmSession, useCustomers, useInvalidateCrm } from "./useCrm";

interface OpportunityFormDialogProps {
  opportunity?: Opportunity | null;
  /** Valores iniciais de uma oportunidade nova (ex.: o cliente da ficha, a etapa da coluna do funil). */
  defaults?: { customer_id?: string | null; stage?: Stage };
  onClose: () => void;
  onSaved?: (id: string) => void;
}

export function OpportunityFormDialog({ opportunity, defaults, onClose, onSaved }: OpportunityFormDialogProps) {
  const { companyId, userId } = useCrmSession();
  const invalidate = useInvalidateCrm();
  const audit = useAudit();
  const { data: customers = [] } = useCustomers();
  const { data: users = [] } = useCompanyUsers();
  const [values, setValues] = useState<Record<string, string>>(() => ({
    title: opportunity?.title ?? "",
    customer_id: opportunity?.customer_id ?? defaults?.customer_id ?? "",
    contact_id: opportunity?.contact_id ?? "",
    value: moneyInput(opportunity?.value ?? null),
    stage: opportunity?.stage ?? defaults?.stage ?? "novo",
    probability: opportunity ? String(opportunity.probability ?? "") : "",
    expected_close_date: opportunity?.expected_close_date?.slice(0, 10) ?? "",
    owner_id: opportunity?.owner_id ?? userId,
    source: opportunity?.source ?? "",
    notes: opportunity?.notes ?? "",
  }));
  const { data: contacts = [] } = useContacts(values.customer_id || undefined);
  const stage = (values.stage || "novo") as Stage;
  const stageOptions = [...OPEN_STAGES, ...(opportunity && !OPEN_STAGES.includes(opportunity.stage) ? [opportunity.stage] : [])];

  const mutation = useMutation({
    mutationFn: async () => {
      const id = await saveOpportunity(
        await getDb(),
        companyId,
        userId,
        {
          title: values.title ?? "",
          customer_id: values.customer_id || null,
          contact_id: values.customer_id ? values.contact_id || null : null,
          value: values.value,
          stage,
          probability: values.probability,
          expected_close_date: values.expected_close_date || null,
          owner_id: values.owner_id || null,
          source: values.source,
          notes: values.notes,
        },
        opportunity?.id,
      );
      await audit(opportunity ? "opportunity.updated" : "opportunity.created", "opportunity", id, `${opportunity ? "Oportunidade editada" : "Oportunidade criada"}: ${values.title?.trim()}`, {
        oldValue: opportunity ?? undefined,
        newValue: values,
      });
      return id;
    },
    onSuccess: (id) => {
      invalidate("opportunities", "activities");
      onSaved?.(id);
      onClose();
    },
  });

  const fields: CrudField[] = [
    { key: "title", label: "Título", required: true, placeholder: "Ex.: Site institucional + manutenção" },
    { key: "customer_id", label: "Cliente", type: "select", options: [{ value: "", label: "Sem cliente (definido ao ganhar)" }, ...customers.map((customer) => ({ value: customer.id, label: customer.name }))] },
    ...(values.customer_id
      ? [{ key: "contact_id", label: "Contato", type: "select" as const, options: [{ value: "", label: "Sem contato" }, ...contacts.map((contact) => ({ value: contact.id, label: contact.name }))] }]
      : []),
    { key: "value", label: "Valor (R$)", placeholder: "0,00" },
    { key: "stage", label: "Etapa", type: "select", options: stageOptions.map((option) => ({ value: option, label: STAGE_LABELS[option] })) },
    { key: "probability", label: "Probabilidade (%)", type: "number", placeholder: `Padrão da etapa: ${STAGE_PROBABILITY[stage] ?? 0}%` },
    { key: "expected_close_date", label: "Fechamento previsto", type: "date" },
    { key: "owner_id", label: "Responsável", type: "select", options: users.map((user) => ({ value: user.id, label: user.name })) },
    { key: "source", label: "Origem", placeholder: "Ex.: Indicação, Site, Prospecção" },
    { key: "notes", label: "Observações", type: "textarea" },
  ];

  return (
    <CrudDialog
      title={opportunity ? "Editar oportunidade" : "Nova oportunidade"}
      fields={fields}
      values={values}
      onChange={(key, value) =>
        setValues((current) => ({
          ...current,
          [key]: value,
          // Trocar a etapa volta para a probabilidade padrão dela; trocar o cliente limpa o contato.
          ...(key === "stage" ? { probability: "" } : {}),
          ...(key === "customer_id" ? { contact_id: "" } : {}),
        }))
      }
      onClose={onClose}
      onSubmit={() => mutation.mutate()}
      busy={mutation.isPending}
    >
      {mutation.error && <p role="alert" className="mt-4 text-sm text-destructive">{errorText(mutation.error)}</p>}
    </CrudDialog>
  );
}
