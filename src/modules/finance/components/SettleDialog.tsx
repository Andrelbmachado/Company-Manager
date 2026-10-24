// Baixa (total ou parcial) de uma conta a pagar ou a receber: principal, data, conta bancária, forma de pagamento e
// encargos (juros, multa, desconto). A regra fica em lib/erp/settlements; aqui só o formulário.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { parseMoneyInput, type FinanceEntry } from "@/lib/erp/financeCommon";
import { settleEntry, type SettleResult } from "@/lib/erp/settlements";
import { fromCents, toCents } from "@/lib/money";
import { formatCurrency, todayIso } from "@/lib/utils";
import { useRequiredSession } from "@/hooks/useSession";
import { CrudDialog } from "@/components/shared/CrudDialog";
import { ErrorNote, PAYMENT_METHODS, errorMessage, invalidateFinance, withEmpty, type FinanceLookups } from "./financeShared";

const money = (value: string) => {
  const parsed = parseMoneyInput(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function SettleDialog({ entry, lookups, onClose, onSettled }: { entry: FinanceEntry; lookups: FinanceLookups; onClose: () => void; onSettled?: (result: SettleResult) => void }) {
  const session = useRequiredSession();
  const qc = useQueryClient();
  const payable = entry.kind === "payable";
  const [form, setForm] = useState<Record<string, string>>({
    amount: String(entry.remaining),
    paid_at: todayIso(),
    bank_account_id: entry.bankAccountId ?? lookups.defaultBankAccountId ?? "",
    payment_method: entry.raw.payment_method ?? "",
    interest: "",
    fine: "",
    discount: "",
    notes: "",
  });
  const principal = money(form.amount);
  const cash = fromCents(toCents(principal) + toCents(money(form.interest)) + toCents(money(form.fine)) - toCents(money(form.discount)));
  const left = fromCents(Math.max(0, toCents(entry.remaining) - toCents(principal)));

  const mutation = useMutation({
    mutationFn: async () => {
      const amount = parseMoneyInput(form.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Informe um valor maior que zero.");
      for (const key of ["interest", "fine", "discount"] as const) {
        if (form[key].trim() && !Number.isFinite(parseMoneyInput(form[key]))) throw new Error("Juros, multa e desconto: use só números (ex.: 12,50).");
      }
      const db = await getDb();
      return settleEntry(db, session.company.id, {
        kind: entry.kind,
        id: entry.id,
        amount,
        paidAt: form.paid_at,
        bankAccountId: form.bank_account_id || null,
        paymentMethod: form.payment_method || null,
        interest: money(form.interest),
        fine: money(form.fine),
        discount: money(form.discount),
        notes: form.notes.trim() || null,
        userId: session.user.id,
      });
    },
    onSuccess: async (result) => {
      invalidateFinance(qc, session.company.id);
      await emit({
        type: payable ? "finance.payable.paid" : "finance.receivable.received",
        companyId: session.company.id,
        actorId: session.user.id,
        entityType: payable ? "payable" : "receivable",
        entityId: entry.id,
        module: "finance",
        title: `${payable ? "Pagamento" : "Recebimento"} de ${formatCurrency(result.cash)}: ${entry.description}`,
        newValue: { status: result.status, paid: result.paid, remaining: result.remaining },
      });
      onSettled?.(result);
      onClose();
    },
  });

  return (
    <CrudDialog
      title={payable ? "Registrar pagamento" : "Registrar recebimento"}
      submitLabel={payable ? "Confirmar pagamento" : "Confirmar recebimento"}
      fields={[
        { key: "amount", label: "Valor (principal)", required: true, placeholder: "0,00" },
        { key: "paid_at", label: payable ? "Data do pagamento" : "Data do recebimento", type: "date", required: true },
        { key: "bank_account_id", label: "Conta bancária", type: "select", options: withEmpty(lookups.bankAccounts.map((account) => ({ value: account.id, label: account.name })), "Sem conta") },
        { key: "payment_method", label: "Forma de pagamento", type: "select", options: withEmpty(PAYMENT_METHODS) },
        { key: "interest", label: "Juros", placeholder: "0,00" },
        { key: "fine", label: "Multa", placeholder: "0,00" },
        { key: "discount", label: "Desconto", placeholder: "0,00" },
        { key: "notes", label: "Observações", type: "textarea" },
      ]}
      values={form}
      onChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))}
      onClose={onClose}
      onSubmit={() => mutation.mutate()}
      busy={mutation.isPending}
    >
      <dl className="mt-4 grid gap-2 rounded-md border bg-muted/30 p-3 text-sm sm:grid-cols-3">
        <div><dt className="text-xs text-muted-foreground">Saldo em aberto</dt><dd className="font-medium tabular-nums">{formatCurrency(entry.remaining)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{payable ? "Total pago agora" : "Total recebido agora"}</dt><dd className="font-medium tabular-nums">{formatCurrency(cash)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Fica em aberto</dt><dd className="font-medium tabular-nums">{formatCurrency(left)}</dd></div>
      </dl>
      <ErrorNote message={mutation.error ? errorMessage(mutation.error) : null} />
    </CrudDialog>
  );
}
