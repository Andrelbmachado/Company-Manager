// Formulário de conta a pagar ou a receber (nova, com parcelas, ou edição). O status não é editável aqui: ele
// acompanha as baixas (lib/erp/settlements) e o cancelamento.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { parseMoneyInput, type EntryKind, type FinanceEntry } from "@/lib/erp/financeCommon";
import { createEntries, updateEntry, type EntryInput } from "@/lib/erp/financeSetup";
import { useRequiredSession } from "@/hooks/useSession";
import { CrudDialog, type CrudField } from "@/components/shared/CrudDialog";
import { ErrorNote, PAYMENT_METHODS, categoryOptions, errorMessage, invalidateFinance, withEmpty, type FinanceLookups } from "./financeShared";

const formFrom = (entry: FinanceEntry | null): Record<string, string> => {
  const raw = entry?.raw;
  return {
    description: entry?.description ?? "",
    amount: entry ? String(entry.amount) : "",
    due_date: raw?.due_date?.slice(0, 10) ?? "",
    competence: raw?.competence ?? "",
    issue_date: raw?.issue_date?.slice(0, 10) ?? "",
    category_id: entry?.categoryId ?? "",
    cost_center_id: entry?.costCenterId ?? "",
    bank_account_id: entry?.bankAccountId ?? "",
    party_id: entry?.partyId ?? "",
    document_number: raw?.document_number ?? "",
    payment_method: raw?.payment_method ?? "",
    installments: "1",
    notes: raw?.notes ?? "",
  };
};

export function EntryFormDialog({ kind, entry, lookups, onClose, onSaved }: { kind: EntryKind; entry: FinanceEntry | null; lookups: FinanceLookups; onClose: () => void; onSaved?: (ids: string[]) => void }) {
  const session = useRequiredSession();
  const qc = useQueryClient();
  const [form, setForm] = useState(() => formFrom(entry));
  const payable = kind === "payable";

  const mutation = useMutation({
    mutationFn: async () => {
      const amount = parseMoneyInput(form.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Informe um valor maior que zero.");
      const input: EntryInput = {
        description: form.description,
        amount,
        dueDate: form.due_date || null,
        issueDate: form.issue_date || null,
        competence: form.competence.trim() || null,
        categoryId: form.category_id || null,
        costCenterId: form.cost_center_id || null,
        bankAccountId: form.bank_account_id || null,
        partyId: form.party_id || null,
        documentNumber: form.document_number,
        paymentMethod: form.payment_method || null,
        notes: form.notes,
      };
      const db = await getDb();
      if (entry) {
        await updateEntry(db, session.company.id, kind, entry.id, input);
        return [entry.id];
      }
      const installments = Number(form.installments || "1");
      if (!Number.isInteger(installments)) throw new Error("Número de parcelas inválido (1 a 120).");
      return createEntries(db, session.company.id, kind, { ...input, installments });
    },
    onSuccess: async (ids) => {
      invalidateFinance(qc, session.company.id);
      await emit({
        type: `finance.${kind}.${entry ? "updated" : "created"}`,
        companyId: session.company.id,
        actorId: session.user.id,
        entityType: kind,
        entityId: ids[0],
        module: "finance",
        title: `${entry ? "Conta editada" : ids.length > 1 ? `${ids.length} parcelas criadas` : "Conta criada"}: ${form.description.trim()}`,
      });
      onSaved?.(ids);
      onClose();
    },
  });

  const fields: CrudField[] = [
    { key: "description", label: "Descrição", required: true },
    { key: "amount", label: entry ? "Valor" : "Valor total", required: true, placeholder: "0,00" },
    { key: "due_date", label: entry || form.installments === "1" ? "Vencimento" : "Vencimento da 1ª parcela", type: "date" },
    { key: "competence", label: "Competência (AAAA-MM)", placeholder: "2026-10" },
    { key: "category_id", label: "Categoria", type: "select", options: withEmpty(categoryOptions(lookups.categories, payable ? "despesa" : "receita"), "Sem categoria") },
    { key: "cost_center_id", label: "Centro de custo", type: "select", options: withEmpty(lookups.costCenters.map((item) => ({ value: item.id, label: item.name }))) },
    { key: "party_id", label: payable ? "Fornecedor" : "Cliente", type: "select", options: withEmpty((payable ? lookups.suppliers : lookups.customers).map((item) => ({ value: item.id, label: item.name }))) },
    { key: "bank_account_id", label: "Conta bancária prevista", type: "select", options: withEmpty(lookups.bankAccounts.map((item) => ({ value: item.id, label: item.name }))) },
    { key: "document_number", label: "Documento (NF, boleto…)" },
    { key: "payment_method", label: "Forma de pagamento", type: "select", options: withEmpty(PAYMENT_METHODS) },
    { key: "issue_date", label: "Emissão", type: "date" },
    ...(entry ? [] : [{ key: "installments", label: "Parcelas", type: "number" as const }]),
    { key: "notes", label: "Observações", type: "textarea" },
  ];

  return (
    <CrudDialog
      title={entry ? "Editar lançamento" : "Novo lançamento"}
      fields={fields}
      values={form}
      onChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))}
      onClose={onClose}
      onSubmit={() => mutation.mutate()}
      busy={mutation.isPending}
    >
      {!entry && Number(form.installments) > 1 && (
        <p className="mt-4 text-sm text-muted-foreground">O valor total é dividido em {form.installments} parcelas mensais; a última fica com a diferença de centavos.</p>
      )}
      {entry && entry.paid > 0 && <p className="mt-4 text-sm text-muted-foreground">Esta conta já tem baixas: o valor não pode ficar abaixo do já pago.</p>}
      <ErrorNote message={mutation.error ? errorMessage(mutation.error) : null} />
    </CrudDialog>
  );
}
