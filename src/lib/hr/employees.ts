// Ficha do colaborador (employees, 0006 + 0008 + 0011): dados pessoais, contrato, endereço e contato de emergência.
// Sem salário: remuneração fica em employee_compensation (0007), só na Folha (CEO e admin).
// Funções com `db` recebem o banco (getDb() na tela, SQLite nos testes); SQL nos padrões do banco demo.
import { v4 as uuidv4 } from "uuid";
import type { DatabaseLike } from "@/lib/db/demo";
import type { ContractType, Employee, EmployeeStatus } from "@/types";

export interface EmployeeAddress {
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
}

export const EMPTY_ADDRESS: EmployeeAddress = { logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "", cep: "" };

export const CONTRACT_TYPES: { value: ContractType; label: string }[] = [
  { value: "clt", label: "CLT" },
  { value: "pj", label: "PJ" },
  { value: "estagio", label: "Estágio" },
  { value: "temporario", label: "Temporário" },
];

export const CONTRACT_LABEL: Record<ContractType, string> = Object.fromEntries(CONTRACT_TYPES.map((item) => [item.value, item.label])) as Record<ContractType, string>;

export const EMPLOYEE_STATUSES: { value: EmployeeStatus; label: string }[] = [
  { value: "ativo", label: "Ativo" },
  { value: "afastado", label: "Afastado" },
  { value: "desligado", label: "Desligado" },
];

/** address_json → endereço com todos os campos (texto). JSON inválido ou vazio → endereço vazio. */
export function parseAddress(json: string | null | undefined): EmployeeAddress {
  if (!json) return { ...EMPTY_ADDRESS };
  try {
    const value = JSON.parse(json) as Record<string, unknown>;
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ...EMPTY_ADDRESS };
    return Object.fromEntries(Object.keys(EMPTY_ADDRESS).map((key) => [key, value[key] == null ? "" : String(value[key]).trim()])) as unknown as EmployeeAddress;
  } catch {
    return { ...EMPTY_ADDRESS };
  }
}

/** "Rua X, 100 - Apto 2 · Centro · Sorocaba/SP · CEP 18035-100" (só as partes preenchidas). */
export function formatAddress(address: EmployeeAddress): string {
  const street = [address.logradouro, address.numero].filter(Boolean).join(", ");
  const line = [street, address.complemento].filter(Boolean).join(" - ");
  const city = [address.cidade, address.uf].filter(Boolean).join("/");
  return [line, address.bairro, city, address.cep ? `CEP ${address.cep}` : ""].filter(Boolean).join(" · ");
}

const digits = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "");

/** Campos da ficha como a tela edita (texto; vazio = sem valor). */
export interface EmployeeInput {
  name: string;
  email: string;
  department: string;
  position: string;
  hire_date: string;
  contract_type: ContractType | "";
  /** Jornada diária em minutos (banco de horas). */
  daily_minutes: number;
  vacation_days_entitled: number;
  status: EmployeeStatus;
  manager_employee_id: string;
  document: string;
  rg: string;
  pis: string;
  phone: string;
  birth_date: string;
  address: EmployeeAddress;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  notes: string;
}

export function emptyEmployeeInput(): EmployeeInput {
  return {
    name: "",
    email: "",
    department: "",
    position: "",
    hire_date: "",
    contract_type: "clt",
    daily_minutes: 480,
    vacation_days_entitled: 30,
    status: "ativo",
    manager_employee_id: "",
    document: "",
    rg: "",
    pis: "",
    phone: "",
    birth_date: "",
    address: { ...EMPTY_ADDRESS },
    emergency_contact_name: "",
    emergency_contact_phone: "",
    notes: "",
  };
}

export function employeeToInput(employee: Employee): EmployeeInput {
  return {
    name: employee.name ?? "",
    email: employee.email ?? "",
    department: employee.department ?? "",
    position: employee.position ?? "",
    hire_date: employee.hire_date?.slice(0, 10) ?? "",
    contract_type: employee.contract_type ?? "",
    daily_minutes: Number(employee.daily_minutes) || 480,
    vacation_days_entitled: Number(employee.vacation_days_entitled ?? 30),
    // "em_ferias" não se grava: férias vêm das solicitações aprovadas.
    status: employee.status === "em_ferias" ? "ativo" : employee.status,
    manager_employee_id: employee.manager_employee_id ?? "",
    document: employee.document ?? "",
    rg: employee.rg ?? "",
    pis: employee.pis ?? "",
    phone: employee.phone ?? "",
    birth_date: employee.birth_date?.slice(0, 10) ?? "",
    address: parseAddress(employee.address_json),
    emergency_contact_name: employee.emergency_contact_name ?? "",
    emergency_contact_phone: employee.emergency_contact_phone ?? "",
    notes: employee.notes ?? "",
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Regras da ficha. Retorna a mensagem do primeiro problema ou null. */
export function validateEmployee(input: EmployeeInput, today: string): string | null {
  if (!input.name.trim()) return "Informe o nome.";
  if (input.email.trim() && !EMAIL.test(input.email.trim())) return "E-mail inválido.";
  if (input.document.trim() && digits(input.document).length !== 11) return "O CPF precisa ter 11 dígitos.";
  if (input.pis.trim() && digits(input.pis).length !== 11) return "O PIS precisa ter 11 dígitos.";
  if (input.phone.trim() && digits(input.phone).length < 10) return "Telefone com DDD: pelo menos 10 dígitos.";
  if (input.emergency_contact_phone.trim() && digits(input.emergency_contact_phone).length < 10) return "Telefone do contato de emergência com DDD: pelo menos 10 dígitos.";
  if (input.birth_date && (!DATE.test(input.birth_date) || input.birth_date >= today)) return "Data de nascimento inválida.";
  if (input.hire_date && !DATE.test(input.hire_date)) return "Data de admissão inválida.";
  if (input.birth_date && input.hire_date && input.hire_date <= input.birth_date) return "A admissão não pode ser antes do nascimento.";
  if (!Number.isInteger(input.daily_minutes) || input.daily_minutes < 60 || input.daily_minutes > 720) return "Jornada diária entre 1 e 12 horas.";
  if (!Number.isInteger(input.vacation_days_entitled) || input.vacation_days_entitled < 0 || input.vacation_days_entitled > 60) return "Dias de férias por ano entre 0 e 60.";
  if (input.address.uf.trim() && !/^[A-Za-z]{2}$/.test(input.address.uf.trim())) return "UF com 2 letras (ex.: SP).";
  if (input.address.cep.trim() && digits(input.address.cep).length !== 8) return "O CEP precisa ter 8 dígitos.";
  return null;
}

const blank = (value: string) => (value.trim() ? value.trim() : null);

/** Endereço para gravar: só os campos preenchidos; UF em maiúsculas. Vazio = '{}' (DEFAULT da 0011). */
function addressJson(address: EmployeeAddress): string {
  const clean = Object.fromEntries(
    Object.entries(address)
      .map(([key, value]) => [key, key === "uf" ? value.trim().toUpperCase() : value.trim()])
      .filter(([, value]) => value),
  );
  return JSON.stringify(clean);
}

export async function fetchEmployee(db: DatabaseLike, companyId: string, id: string): Promise<Employee | null> {
  const rows = await db.select<Employee[]>("SELECT * FROM employees WHERE company_id=? AND id=? AND deleted_at IS NULL", [companyId, id]);
  return rows[0] ?? null;
}

export interface SaveEmployeeResult {
  id: string;
  /** Cadastro novo. */
  created: boolean;
  /** Ao cadastrar, já existia alguém com o mesmo e-mail (ex.: criado pelo Meu RH no primeiro acesso): completou esse. */
  merged: boolean;
}

/**
 * Cria ou atualiza a ficha. Mesmo e-mail = mesma pessoa: ao cadastrar, completa o cadastro existente (o Meu RH cria o
 * de quem já entrou) em vez de duplicar; ao editar, recusa e-mail ou CPF de outro colaborador.
 */
export async function saveEmployee(db: DatabaseLike, companyId: string, input: EmployeeInput, existingId: string | null, today: string): Promise<SaveEmployeeResult> {
  const problem = validateEmployee(input, today);
  if (problem) throw new Error(problem);
  const email = input.email.trim().toLowerCase() || null;
  const cpf = digits(input.document);
  const all = await db.select<Employee[]>("SELECT * FROM employees WHERE company_id=? AND deleted_at IS NULL", [companyId]);
  if (existingId && !all.some((employee) => employee.id === existingId)) throw new Error("Colaborador não encontrado.");
  const sameEmail = email ? all.find((employee) => employee.id !== existingId && employee.email?.toLowerCase() === email) : undefined;
  if (existingId && sameEmail) throw new Error(`Já existe um colaborador com este e-mail: ${sameEmail.name}.`);
  const target = existingId ?? sameEmail?.id ?? null;
  const sameCpf = cpf ? all.find((employee) => employee.id !== target && digits(employee.document) === cpf) : undefined;
  if (sameCpf) throw new Error(`Já existe um colaborador com este CPF: ${sameCpf.name}.`);
  if (input.manager_employee_id && input.manager_employee_id === target) throw new Error("O colaborador não pode ser o próprio gestor.");

  const values = [
    input.name.trim(),
    email,
    blank(input.department),
    blank(input.position),
    blank(input.hire_date),
    input.contract_type || null,
    input.daily_minutes,
    input.vacation_days_entitled,
    input.status,
    blank(input.manager_employee_id),
    blank(input.document),
    blank(input.rg),
    blank(input.pis),
    blank(input.phone),
    blank(input.birth_date),
    addressJson(input.address),
    blank(input.emergency_contact_name),
    blank(input.emergency_contact_phone),
    blank(input.notes),
  ];
  if (target) {
    await db.execute(
      "UPDATE employees SET name=?, email=?, department=?, position=?, hire_date=?, contract_type=?, daily_minutes=?, vacation_days_entitled=?, status=?, manager_employee_id=?, document=?, rg=?, pis=?, phone=?, birth_date=?, address_json=?, emergency_contact_name=?, emergency_contact_phone=?, notes=?, updated_at=datetime('now') WHERE company_id=? AND id=?",
      [...values, companyId, target],
    );
    return { id: target, created: false, merged: !existingId };
  }
  const id = uuidv4();
  await db.execute(
    "INSERT INTO employees (id, company_id, name, email, department, position, hire_date, contract_type, daily_minutes, vacation_days_entitled, status, manager_employee_id, document, rg, pis, phone, birth_date, address_json, emergency_contact_name, emergency_contact_phone, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [id, companyId, ...values],
  );
  return { id, created: true, merged: false };
}
