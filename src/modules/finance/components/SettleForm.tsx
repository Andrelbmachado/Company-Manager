// Baixa (total ou parcial) de uma conta a pagar ou a receber, no próprio lugar (dentro da ficha da conta):
// principal, data, conta bancária, forma de pagamento e encargos. A regra fica em lib/erp/settlements.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { parseMoneyInput, type FinanceEntry } from "@/lib/erp/financeCommon";
import { settleEntry, type SettleResult } from "@/lib/erp/settlements";
import { fromCents, toCents } from "@/lib/money";
import { formatCurrency, todayIso } from "@/lib/utils";
import { useRequiredSession } from "@/hooks/useSession";
import { ErrorNote, Field, PAYMENT_METHODS, errorMessage, inputClass, invalidateFinance, primaryButton, secondaryButton, type FinanceLookups } from "./financeShared";

const money = (value: string) => {
  const parsed = parseMoneyInput(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function SettleForm({ entry, lookups, onDone, onCancel }: { entry: FinanceEntry; lookups: FinanceLookups; onDone?: (result: SettleResult) => void; onCancel: () => void }) {
  const session = useRequiredSession();
  const qc = useQueryClient();
  const payable = entry.kind === "payable";
  const [form, setForm] = useState({
    amount: entry.remaining.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    paid_at: todayIso(),
    bank_account_id: entry.bankAccountId ?? lookups.defaultBankAccountId ?? "",
    payment_method: entry.raw.payment_method ?? "",
    interest: "",
    fine: "",
    discount: "",
    notes: "",
  });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value }));
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
      onDone?.(result);
    },
  });

  return (
    <form
      aria-label={payable ? "Registrar pagamento" : "Registrar recebimento"}
      className="space-y-4 rounded-lg border bg-muted/20 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <h3 className="text-sm font-semibold">{payable ? "Registrar pagamento" : "Registrar recebimento"}</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Valor (principal)">
          <input className={inputClass} inputMode="decimal" required value={form.amount} onChange={set("amount")} />
        </Field>
        <Field label={payable ? "Data do pagamento" : "Data do recebimento"}>
          <input className={inputClass} type="date" required value={form.paid_at} onChange={set("paid_at")} />
        </Field>
        <Field label="Conta bancária">
          <select className={inputClass} value={form.bank_account_id} onChange={set("bank_account_id")}>
            <option value="">Sem conta</option>
            {lookups.bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
        </Field>
        <Field label="Forma de pagamento">
          <select className={inputClass} value={form.payment_method} onChange={set("payment_method")}>
            <option value="">—</option>
            {PAYMENT_METHODS.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
          </select>
        </Field>
        <Field label="Juros">
          <input className={inputClass} inputMode="decimal" placeholder="0,00" value={form.interest} onChange={set("interest")} />
        </Field>
        <Field label="Multa">
          <input className={inputClass} inputMode="decimal" placeholder="0,00" value={form.fine} onChange={set("fine")} />
        </Field>
        <Field label="Desconto">
          <input className={inputClass} inputMode="decimal" placeholder="0,00" value={form.discount} onChange={set("discount")} />
        </Field>
        <Field label="Observações">
          <input className={inputClass} value={form.notes} onChange={set("notes")} />
        </Field>
      </div>
      <dl className="grid gap-2 rounded-md border bg-background p-3 text-sm sm:grid-cols-3">
        <div><dt className="text-xs text-muted-foreground">Saldo em aberto</dt><dd className="font-medium tabular-nums">{formatCurrency(entry.remaining)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{payable ? "Total pago agora" : "Total recebido agora"}</dt><dd className="font-medium tabular-nums">{formatCurrency(cash)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Fica em aberto</dt><dd className="font-medium tabular-nums">{formatCurrency(left)}</dd></div>
      </dl>
      <ErrorNote message={mutation.error ? errorMessage(mutation.error) : null} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={mutation.isPending} className={primaryButton}>{payable ? "Confirmar pagamento" : "Confirmar recebimento"}</button>
        <button type="button" onClick={onCancel} className={secondaryButton}>Cancelar</button>
      </div>
    </form>
  );
}
