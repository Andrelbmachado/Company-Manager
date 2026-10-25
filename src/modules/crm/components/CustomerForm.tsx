import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { getDb } from "@/lib/db/client";
import { saveCustomer, type CustomerInput } from "@/lib/crm/queries";
import type { Customer } from "@/types";
import { moneyInput } from "./format";
import { InlineForm, type InlineField } from "./InlineForm";
import { errorText } from "./Modal";
import { useAudit, useCompanyUsers, useCrmSession, useInvalidateCrm, usePriceLists } from "./useCrm";

/** Endereço guardado em address_json (as chaves extras de outras telas são preservadas). */
export interface AddressFields {
  logradouro?: string;
  numero?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  cep?: string;
}

export function parseAddress(json: string | null | undefined): AddressFields & Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as AddressFields & Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Uma linha: "Rua X, 10 - Centro - Sorocaba/SP - CEP 18000-000". */
export function formatAddress(json: string | null | undefined): string {
  const address = parseAddress(json);
  const street = [address.logradouro, address.numero].filter(Boolean).join(", ");
  const city = [address.cidade, address.uf].filter(Boolean).join("/");
  return [street, address.bairro, city, address.cep ? `CEP ${address.cep}` : ""].filter(Boolean).join(" - ");
}

const ADDRESS_KEYS = ["logradouro", "numero", "bairro", "cidade", "uf", "cep"] as const;

function initialValues(customer: Customer | null | undefined, userId: string): Record<string, string> {
  const address = parseAddress(customer?.address_json);
  return {
    name: customer?.name ?? "",
    type: customer?.type ?? "PJ",
    trade_name: customer?.trade_name ?? "",
    document: customer?.document ?? "",
    state_registration: customer?.state_registration ?? "",
    email: customer?.email ?? "",
    phone: customer?.phone ?? "",
    website: customer?.website ?? "",
    segment: customer?.segment ?? "",
    source: customer?.source ?? "",
    owner_id: customer ? customer.owner_id ?? "" : userId,
    status: customer?.status ?? "active",
    payment_terms: customer?.payment_terms ?? "",
    credit_limit: moneyInput(customer?.credit_limit),
    price_list_id: customer?.price_list_id ?? "",
    ...Object.fromEntries(ADDRESS_KEYS.map((key) => [`address_${key}`, typeof address[key] === "string" ? (address[key] as string) : ""])),
    notes: customer?.notes ?? "",
  };
}

interface CustomerFormProps {
  customer?: Customer | null;
  onClose: () => void;
  /** Depois de salvar, no lugar de onClose. */
  onSaved?: (id: string) => void;
}

/** Cadastro completo do cliente (criar e editar), na própria página: no lugar do bloco Cadastro da ficha ou em /nova. */
export function CustomerForm({ customer, onClose, onSaved }: CustomerFormProps) {
  const { companyId, userId } = useCrmSession();
  const invalidate = useInvalidateCrm();
  const audit = useAudit();
  const { data: users = [] } = useCompanyUsers();
  const { data: priceLists = [] } = usePriceLists();
  const [values, setValues] = useState(() => initialValues(customer, userId));

  const mutation = useMutation({
    mutationFn: async () => {
      const db = await getDb();
      const address = { ...parseAddress(customer?.address_json) } as Record<string, unknown>;
      for (const key of ADDRESS_KEYS) {
        const value = values[`address_${key}`]?.trim();
        if (value) address[key] = value;
        else delete address[key];
      }
      const input: CustomerInput = {
        name: values.name ?? "",
        type: values.type ?? "PJ",
        trade_name: values.trade_name,
        document: values.document,
        state_registration: values.state_registration,
        email: values.email,
        phone: values.phone,
        website: values.website,
        segment: values.segment,
        source: values.source,
        owner_id: values.owner_id,
        status: values.status,
        payment_terms: values.payment_terms,
        credit_limit: values.credit_limit,
        price_list_id: values.price_list_id,
        notes: values.notes,
        address_json: JSON.stringify(address),
      };
      const id = await saveCustomer(db, companyId, input, customer?.id);
      await audit(customer ? "customer.updated" : "customer.created", "customer", id, `${customer ? "Cliente editado" : "Cliente criado"}: ${values.name.trim()}`, {
        oldValue: customer ?? undefined,
        newValue: values,
      });
      return id;
    },
    onSuccess: (id) => {
      invalidate("customers");
      // Com onSaved quem chamou decide o que acontece (ex.: abrir a ficha nova); sem ele, o formulário fecha.
      if (onSaved) onSaved(id);
      else onClose();
    },
  });

  const fields: InlineField[] = [
    { key: "name", label: "Nome / razão social", required: true },
    { key: "type", label: "Tipo", type: "select", options: [{ value: "PJ", label: "Pessoa jurídica" }, { value: "PF", label: "Pessoa física" }] },
    { key: "trade_name", label: "Nome fantasia" },
    { key: "document", label: values.type === "PF" ? "CPF" : "CNPJ" },
    { key: "state_registration", label: "Inscrição estadual" },
    { key: "email", label: "E-mail", type: "email" },
    { key: "phone", label: "Telefone" },
    { key: "website", label: "Site" },
    { key: "segment", label: "Segmento", placeholder: "Ex.: Saúde, Varejo" },
    { key: "source", label: "Origem", placeholder: "Ex.: Indicação, Site" },
    { key: "owner_id", label: "Responsável", type: "select", options: [{ value: "", label: "Sem responsável" }, ...users.map((user) => ({ value: user.id, label: user.name }))] },
    { key: "status", label: "Situação", type: "select", options: [{ value: "active", label: "Ativo" }, { value: "inactive", label: "Inativo" }] },
    { key: "payment_terms", label: "Condição de pagamento", placeholder: "Ex.: 30/60 dias" },
    { key: "credit_limit", label: "Limite de crédito (R$)", placeholder: "0,00" },
    { key: "price_list_id", label: "Tabela de preço", type: "select", options: [{ value: "", label: "Preço do catálogo" }, ...priceLists.map((list) => ({ value: list.id, label: list.name }))] },
    { key: "address_cep", label: "CEP" },
    { key: "address_logradouro", label: "Endereço" },
    { key: "address_numero", label: "Número" },
    { key: "address_bairro", label: "Bairro" },
    { key: "address_cidade", label: "Cidade" },
    { key: "address_uf", label: "UF" },
    { key: "notes", label: "Observações", type: "textarea" },
  ];

  return (
    <InlineForm
      title={customer ? `Editar cadastro de ${customer.name}` : "Novo cliente"}
      fields={fields}
      values={values}
      onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
      onCancel={onClose}
      onSubmit={() => mutation.mutate()}
      busy={mutation.isPending}
      submitLabel={customer ? "Salvar" : "Cadastrar"}
    >
      {mutation.error && <p role="alert" className="text-sm text-destructive">{errorText(mutation.error)}</p>}
    </InlineForm>
  );
}
