// Importação de colaboradores (planilha → employees), com as regras do RH: mesma pessoa = mesmo e-mail ou mesmo CPF
// (atualiza em vez de duplicar, inclusive o cadastro que o Meu RH criou no primeiro acesso); célula vazia não apaga o
// que já está na ficha; endereço em colunas vira address_json; sem salário (remuneração é só da Folha).
//
// TODO(integração): o motor de importação (Tarefa 5) registra entidades em src/lib/importexport/importers/<chave>.ts.
// Para ligar esta, criar importers/employees.ts com `export { employeeImportEntity as entity } from "@/lib/hr/employeeImport";`
// (ou usar upsertEmployees dentro do importer que a Tarefa 5 escrever).
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import type { DatabaseLike } from "@/lib/db/demo";
import type { FieldDef, ImportEntity } from "@/lib/importexport/registry";
import type { Employee } from "@/types";
import { CONTRACT_TYPES, EMPLOYEE_STATUSES, EMPTY_ADDRESS, parseAddress, type EmployeeAddress } from "./employees";

const ADDRESS_KEYS = Object.keys(EMPTY_ADDRESS) as (keyof EmployeeAddress)[];

export const EMPLOYEE_IMPORT_FIELDS: FieldDef[] = [
  { key: "name", label: "Nome", kind: "text", required: true, aliases: ["nome completo", "colaborador", "funcionário", "funcionario"], example: "Maria Souza" },
  { key: "email", label: "E-mail", kind: "email", aliases: ["email", "e-mail corporativo"], example: "maria.souza@empresa.com.br", hint: "Chave para atualizar: mesmo e-mail = mesma pessoa." },
  { key: "document", label: "CPF", kind: "cpf", aliases: ["cpf", "documento"], example: "123.456.789-09", hint: "Sem e-mail, o CPF identifica a pessoa." },
  { key: "rg", label: "RG", kind: "text", example: "12.345.678-9" },
  { key: "pis", label: "PIS", kind: "text", aliases: ["pis/pasep", "nis", "pasep"], example: "120.12345.67-8" },
  { key: "phone", label: "Telefone", kind: "phone", aliases: ["celular", "whatsapp", "fone"], example: "(15) 99999-0000" },
  { key: "birth_date", label: "Nascimento", kind: "date", aliases: ["data de nascimento", "nascido em"], example: "20/05/1990" },
  { key: "department", label: "Setor", kind: "text", aliases: ["departamento", "área", "area"], example: "Comercial" },
  { key: "position", label: "Cargo", kind: "text", aliases: ["função", "funcao"], example: "Vendedora" },
  { key: "hire_date", label: "Admissão", kind: "date", aliases: ["data de admissão", "data de admissao", "início", "inicio"], example: "01/03/2024" },
  { key: "contract_type", label: "Contrato", kind: "enum", aliases: ["tipo de contrato", "vínculo", "vinculo"], options: CONTRACT_TYPES, example: "CLT" },
  { key: "vacation_days_entitled", label: "Dias de férias por ano", kind: "int", aliases: ["férias", "ferias"], example: "30" },
  { key: "status", label: "Situação", kind: "enum", aliases: ["status"], options: EMPLOYEE_STATUSES, example: "Ativo" },
  { key: "logradouro", label: "Endereço", kind: "text", aliases: ["rua", "logradouro"], example: "Rua das Palmeiras" },
  { key: "numero", label: "Número", kind: "text", aliases: ["nº", "no"], example: "100" },
  { key: "complemento", label: "Complemento", kind: "text", example: "Apto 12" },
  { key: "bairro", label: "Bairro", kind: "text", example: "Centro" },
  { key: "cidade", label: "Cidade", kind: "text", aliases: ["município", "municipio"], example: "Sorocaba" },
  { key: "uf", label: "UF", kind: "text", aliases: ["estado"], example: "SP" },
  { key: "cep", label: "CEP", kind: "text", example: "18035-100" },
  { key: "emergency_contact_name", label: "Contato de emergência", kind: "text", aliases: ["emergência", "emergencia"], example: "João Souza" },
  { key: "emergency_contact_phone", label: "Telefone de emergência", kind: "phone", aliases: ["fone de emergência"], example: "(15) 98888-1111" },
  { key: "notes", label: "Observações", kind: "text", aliases: ["obs", "observação", "observacao"] },
];

/** Texto da planilha: vazio/espaços → null. Números (Excel) viram texto. */
const text = z.preprocess((value) => {
  if (value === undefined || value === null) return null;
  const raw = String(value).trim();
  return raw === "" ? null : raw;
}, z.string().nullable());

/** Valor de lista: aceita a chave ("clt") ou o rótulo ("CLT", "Estágio"), sem diferenciar maiúsculas. */
function option<T extends string>(options: { value: T; label: string }[], what: string) {
  const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  return z.preprocess((value) => {
    if (value === undefined || value === null || String(value).trim() === "") return null;
    const wanted = fold(String(value));
    return options.find((item) => fold(item.value) === wanted || fold(item.label) === wanted)?.value ?? String(value);
  }, z.enum(options.map((item) => item.value) as [T, ...T[]], { errorMap: () => ({ message: `${what} inválido(a): use ${options.map((item) => item.label).join(", ")}` }) }).nullable());
}

/** Data já normalizada pelo motor de importação ('YYYY-MM-DD'); dd/mm/aaaa também é aceito aqui. */
const date = z.preprocess((value) => {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const raw = String(value).trim();
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return br ? `${br[3]}-${br[2]}-${br[1]}` : raw;
}, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (use dd/mm/aaaa)").nullable());

export const employeeImportSchema = z.object({
  name: z.preprocess((value) => (value == null ? "" : String(value).trim()), z.string().min(1, "Informe o nome")),
  email: z.preprocess((value) => (value == null || String(value).trim() === "" ? null : String(value).trim().toLowerCase()), z.string().email("E-mail inválido").nullable()),
  document: text.refine((value) => value === null || value.replace(/\D/g, "").length === 11, "O CPF precisa ter 11 dígitos"),
  rg: text,
  pis: text,
  phone: text,
  birth_date: date,
  department: text,
  position: text,
  hire_date: date,
  contract_type: option(CONTRACT_TYPES, "Contrato"),
  vacation_days_entitled: z.preprocess((value) => (value === undefined || value === null || String(value).trim() === "" ? null : Number(String(value).replace(",", "."))), z.number().int("Dias de férias inteiros").min(0).max(60).nullable()),
  status: option(EMPLOYEE_STATUSES, "Situação"),
  logradouro: text,
  numero: text,
  complemento: text,
  bairro: text,
  cidade: text,
  uf: text.refine((value) => value === null || /^[A-Za-z]{2}$/.test(value), "UF com 2 letras"),
  cep: text.refine((value) => value === null || value.replace(/\D/g, "").length === 8, "O CEP precisa ter 8 dígitos"),
  emergency_contact_name: text,
  emergency_contact_phone: text,
  notes: text,
});

export type EmployeeImportRow = z.infer<typeof employeeImportSchema>;

const digits = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "");

/** Chave natural: e-mail; sem e-mail, CPF (só dígitos); sem os dois, o nome. */
export function employeeNaturalKey(row: Pick<EmployeeImportRow, "email" | "document" | "name">): string {
  if (row.email) return `email:${row.email.toLowerCase()}`;
  if (digits(row.document)) return `cpf:${digits(row.document)}`;
  return `nome:${row.name.trim().toLowerCase()}`;
}

/** Colunas simples da ficha que a planilha preenche (o endereço vai junto em address_json). */
const COLUMNS = ["name", "email", "document", "rg", "pis", "phone", "birth_date", "department", "position", "hire_date", "contract_type", "vacation_days_entitled", "status", "emergency_contact_name", "emergency_contact_phone", "notes"] as const;

/**
 * Grava as linhas: atualiza quem já existe (por e-mail, CPF ou, sem os dois, nome igual) só nos campos preenchidos;
 * cria os demais (ativo, 30 dias de férias, jornada de 8h). Linhas repetidas no arquivo contam uma vez.
 */
export async function upsertEmployees(db: DatabaseLike, companyId: string, rows: EmployeeImportRow[]): Promise<{ inserted: number; updated: number }> {
  const existing = await db.select<Employee[]>("SELECT * FROM employees WHERE company_id=? AND deleted_at IS NULL", [companyId]);
  const find = (row: EmployeeImportRow): Employee | undefined =>
    (row.email ? existing.find((employee) => employee.email?.toLowerCase() === row.email) : undefined) ??
    (digits(row.document) ? existing.find((employee) => digits(employee.document) === digits(row.document)) : undefined) ??
    (!row.email && !digits(row.document) ? existing.find((employee) => employee.name.trim().toLowerCase() === row.name.trim().toLowerCase()) : undefined);

  let inserted = 0;
  let updated = 0;
  const touched = new Set<string>();
  for (const row of rows) {
    const values: Record<string, string | number | null> = {};
    for (const column of COLUMNS) if (row[column] !== null && row[column] !== undefined) values[column] = row[column] as string | number;
    if (values.uf) values.uf = String(values.uf).toUpperCase();
    const target = find(row);
    const address = { ...parseAddress(target?.address_json) };
    let addressChanged = false;
    for (const key of ADDRESS_KEYS) {
      const value = row[key];
      if (value) {
        address[key] = key === "uf" ? value.toUpperCase() : value;
        addressChanged = true;
      }
    }
    const addressJson = JSON.stringify(Object.fromEntries(Object.entries(address).filter(([, value]) => value)));

    if (target) {
      const assignments = Object.keys(values);
      if (addressChanged) assignments.push("address_json");
      if (assignments.length > 0) {
        await db.execute(
          `UPDATE employees SET ${assignments.map((column) => `${column}=?`).join(", ")}, updated_at=datetime('now') WHERE company_id=? AND id=?`,
          [...Object.values(values), ...(addressChanged ? [addressJson] : []), companyId, target.id],
        );
      }
      if (!touched.has(target.id)) updated += 1;
      touched.add(target.id);
      Object.assign(target, values, addressChanged ? { address_json: addressJson } : {});
      continue;
    }
    const id = uuidv4();
    const row_ = { status: "ativo", vacation_days_entitled: 30, daily_minutes: 480, ...values, address_json: addressJson };
    const columns = Object.keys(row_);
    await db.execute(`INSERT INTO employees (id, company_id, ${columns.join(", ")}) VALUES (?, ?, ${columns.map(() => "?").join(", ")})`, [id, companyId, ...Object.values(row_)]);
    existing.push({ id, company_id: companyId, ...row_ } as unknown as Employee);
    touched.add(id);
    inserted += 1;
  }
  return { inserted, updated };
}

/** Entidade "Colaboradores" no formato do registro de importação (Tarefa 5). Importar exige `create` em hr_admin. */
export const employeeImportEntity: ImportEntity<EmployeeImportRow> = {
  key: "employees",
  label: "Colaboradores",
  resource: "hr_admin",
  fields: EMPLOYEE_IMPORT_FIELDS,
  schema: employeeImportSchema as unknown as ImportEntity<EmployeeImportRow>["schema"],
  naturalKey: employeeNaturalKey,
  upsert: upsertEmployees,
};
