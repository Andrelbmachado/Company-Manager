// Colaboradores (Gestão de RH): entidade única de importação/exportação do RH (botões da Gestão de RH e tela de
// importações). Identifica por CPF, depois e-mail (o cadastro que o Meu RH criou no primeiro acesso só tem e-mail),
// depois nome. Célula vazia não apaga. Sem salário: remuneração é da Folha. Desligado que a planilha volta para outra
// situação é readmissão, como na ficha (clearTermination): o desligamento e as tarefas de desligamento saem, senão
// applyDueTerminations desligaria a pessoa de novo pela data antiga.
import { z } from "zod";
import type { FieldDef } from "../registry";
import { decimal, integer, isoDate, oneOf, optionalText, requiredText } from "../schema";
import { ADDRESS_FIELDS, addressColumn, addressExport, defineTableEntity, emailKey } from "../tableEntity";
import { sqliteNow, updateRows, type Row } from "../write";

const CONTRACTS = [
  { value: "clt", label: "CLT" },
  { value: "pj", label: "PJ" },
  { value: "estagio", label: "Estágio" },
  { value: "temporario", label: "Temporário" },
] as const;

const STATUS = [
  { value: "ativo", label: "Ativo" },
  { value: "em_ferias", label: "Em férias" },
  { value: "afastado", label: "Afastado" },
  { value: "desligado", label: "Desligado" },
] as const;

const fields: FieldDef[] = [
  { key: "name", label: "Nome", kind: "text", required: true, aliases: ["colaborador", "funcionário", "funcionario", "nome completo"], example: "João da Silva" },
  { key: "document", label: "CPF", kind: "cpf", aliases: ["documento"], example: "529.982.247-25" },
  { key: "rg", label: "RG", kind: "text", aliases: ["identidade"], example: "12.345.678-9" },
  { key: "pis", label: "PIS", kind: "text", aliases: ["pis/pasep", "nis"], example: "120.12345.67-8" },
  { key: "email", label: "E-mail", kind: "email", aliases: ["email", "e-mail corporativo"], example: "joao.silva@empresa.com.br" },
  { key: "phone", label: "Telefone", kind: "phone", aliases: ["celular", "fone"], example: "(11) 98765-4321" },
  { key: "birth_date", label: "Data de nascimento", kind: "date", aliases: ["nascimento", "data nasc"], example: "15/03/1990" },
  { key: "hire_date", label: "Data de admissão", kind: "date", aliases: ["admissão", "admissao", "data de entrada"], example: "01/02/2024" },
  { key: "department", label: "Departamento", kind: "text", aliases: ["setor", "área", "area"], example: "Comercial" },
  { key: "position", label: "Cargo", kind: "text", aliases: ["função", "funcao"], example: "Vendedor" },
  { key: "contract_type", label: "Tipo de contrato", kind: "enum", options: [...CONTRACTS], aliases: ["contrato", "regime", "vínculo"], example: "CLT" },
  { key: "status", label: "Situação", kind: "enum", options: [...STATUS], aliases: ["status"], example: "Ativo" },
  { key: "vacation_days_entitled", label: "Dias de férias por ano", kind: "int", aliases: ["dias de férias", "férias"], example: "30" },
  { key: "daily_hours", label: "Jornada diária (horas)", kind: "number", aliases: ["jornada", "horas por dia", "carga horária diária"], example: "8" },
  { key: "termination_date", label: "Data de desligamento", kind: "date", aliases: ["desligamento", "demissão", "data de saída"], example: "" },
  { key: "termination_reason", label: "Motivo do desligamento", kind: "text", aliases: ["motivo da saída"], example: "" },
  { key: "emergency_contact_name", label: "Contato de emergência", kind: "text", aliases: ["emergência", "contato emergencia"], example: "Maria da Silva" },
  { key: "emergency_contact_phone", label: "Telefone de emergência", kind: "phone", aliases: ["telefone emergência"], example: "(11) 91234-5678" },
  ...ADDRESS_FIELDS,
  { key: "notes", label: "Observações", kind: "text", aliases: ["observacoes", "obs", "notas"], example: "" },
];

const schema = z
  .object({
    name: requiredText(200),
    document: optionalText(20),
    rg: optionalText(30),
    pis: optionalText(30),
    email: optionalText(200),
    phone: optionalText(40),
    birth_date: isoDate().optional(),
    hire_date: isoDate().optional(),
    department: optionalText(120),
    position: optionalText(120),
    contract_type: oneOf(["clt", "pj", "estagio", "temporario"]).optional(),
    status: oneOf(["ativo", "em_ferias", "afastado", "desligado"]).optional(),
    vacation_days_entitled: integer(0, 60).optional(),
    daily_hours: decimal(1, 24).optional(),
    termination_date: isoDate().optional(),
    termination_reason: optionalText(300),
    emergency_contact_name: optionalText(200),
    emergency_contact_phone: optionalText(40),
    endereco_cep: optionalText(20),
    endereco_logradouro: optionalText(200),
    endereco_numero: optionalText(20),
    endereco_complemento: optionalText(120),
    endereco_bairro: optionalText(120),
    endereco_cidade: optionalText(120),
    endereco_uf: optionalText(2),
    notes: optionalText(4000),
  })
  .superRefine((row, context) => {
    if (row.termination_date && row.hire_date && row.termination_date < row.hire_date) {
      context.addIssue({ code: "custom", path: ["termination_date"], message: "O desligamento é antes da admissão" });
    }
  });

export type EmployeeImportRow = z.infer<typeof schema>;

export const entity = defineTableEntity<EmployeeImportRow>({
  key: "employees",
  label: "Colaboradores",
  description: "Cadastro de colaboradores do RH (sem salário).",
  resource: "hr_admin",
  table: "employees",
  fields,
  schema,
  keys: [
    { name: "CPF", fromRow: (row) => row.document, fromDb: (row) => row.document },
    { name: "e-mail", fromRow: (row) => row.email, fromDb: (row) => row.email, compare: emailKey },
    { name: "nome", fromRow: (row) => row.name, fromDb: (row) => row.name },
  ],
  toColumns: (row, { existing }) => ({
    name: row.name,
    document: row.document,
    rg: row.rg,
    pis: row.pis,
    email: row.email,
    phone: row.phone,
    birth_date: row.birth_date,
    hire_date: row.hire_date,
    department: row.department,
    position: row.position,
    contract_type: row.contract_type,
    status: row.status ?? (row.termination_date ? "desligado" : undefined),
    vacation_days_entitled: row.vacation_days_entitled,
    daily_minutes: row.daily_hours === undefined ? undefined : Math.round(row.daily_hours * 60),
    termination_date: row.termination_date,
    termination_reason: row.termination_reason,
    emergency_contact_name: row.emergency_contact_name,
    emergency_contact_phone: row.emergency_contact_phone,
    address_json: addressColumn(row, existing),
    notes: row.notes,
  }),
  insertDefaults: () => ({ status: "ativo", vacation_days_entitled: 30, daily_minutes: 480 }),
  afterWrite: async (db, companyId, written, context) => {
    const readmitted = written.filter(({ row, existing }) => existing?.status === "desligado" && !!row.status && row.status !== "desligado" && !row.termination_date);
    if (readmitted.length === 0) return;
    const now = sqliteNow();
    await updateRows(
      db,
      "employees",
      companyId,
      readmitted
        .filter(({ existing }) => existing!.termination_date != null || existing!.termination_reason != null)
        .map(({ id, existing }) => ({
          id,
          values: { termination_date: null, termination_reason: null },
          previous: { termination_date: existing!.termination_date ?? null, termination_reason: existing!.termination_reason ?? null },
        })),
      context.journal,
    );
    const ids = new Set(readmitted.map(({ id }) => id));
    const exitTasks = (await db.select<Row[]>("SELECT * FROM hr_tasks WHERE company_id=? AND deleted_at IS NULL", [companyId])).filter(
      (task) => !task.deleted_at && task.category === "desligamento" && ids.has(String(task.employee_id)),
    );
    await updateRows(
      db,
      "hr_tasks",
      companyId,
      exitTasks.map((task) => ({ id: String(task.id), values: { deleted_at: now, updated_at: now }, previous: { deleted_at: null, updated_at: task.updated_at ?? null } })),
      context.journal,
    );
  },
  exportExtra: (row) => ({
    ...addressExport(row),
    daily_hours: typeof row.daily_minutes === "number" ? Math.round((row.daily_minutes / 60) * 100) / 100 : null,
  }),
});
