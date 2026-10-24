// TEMPORÁRIO (dados de exemplo): RH — dados de admissão dos colaboradores (0008/0011), uma admissão em andamento,
// um desligamento com checklist e lançamentos de banco de horas. Documentos e endereços são fictícios.
// Precisa de colaboradores; sem eles não grava nada (nem a flag).
import { getDb } from "@/lib/db/client";
import { day, hasSeedFlag, insertRows, memberFor, membersByRole, selectRows, setSeedFlag, ts } from "../seedUtils";

const AREA = "hr";

interface EmployeeRow {
  id: string;
  name: string;
  user_id?: string | null;
  status?: string | null;
}

const STREETS = ["Rua das Palmeiras", "Avenida São Paulo", "Rua XV de Novembro", "Rua Barão de Tatuí", "Avenida Itavuvu", "Rua da Penha"];
const DISTRICTS = ["Centro", "Jardim Europa", "Campolim", "Vila Hortência", "Éden", "Santa Rosália"];
const EMERGENCY = ["Maria Souza", "João Oliveira", "Ana Lima", "Carlos Pereira", "Beatriz Costa", "Paulo Rocha"];

const pad = (value: number, width: number) => String(value).padStart(width, "0");

/** CPF, RG, PIS e telefone fictícios (só formato), estáveis pela posição do colaborador. */
function documentsFor(index: number) {
  const n = index + 11;
  return {
    document: `${pad(100 + n, 3)}.${pad(200 + n * 3, 3)}.${pad(300 + n * 7, 3)}-${pad(n % 100, 2)}`,
    rg: `${pad(10 + (n % 90), 2)}.${pad(100 + n * 5, 3)}.${pad(200 + n * 9, 3)}-${n % 10}`,
    pis: `${pad(120 + (n % 80), 3)}.${pad(10000 + n * 37, 5)}.${pad(n % 100, 2)}-${n % 10}`,
    phone: `(15) 9${pad(8100 + n * 13, 4)}-${pad(1000 + n * 77, 4)}`,
    birth_date: `${1975 + (n % 25)}-${pad(1 + (n % 12), 2)}-${pad(1 + (n % 27), 2)}`,
  };
}

function addressFor(index: number): string {
  return JSON.stringify({
    logradouro: STREETS[index % STREETS.length],
    numero: String(100 + index * 17),
    complemento: index % 3 === 0 ? `Apto ${10 + index}` : "",
    bairro: DISTRICTS[index % DISTRICTS.length],
    cidade: "Sorocaba",
    uf: "SP",
    cep: `18${pad(35 + index, 3)}-${pad(100 + index * 3, 3)}`,
  });
}

export async function seed(companyId: string): Promise<void> {
  if (await hasSeedFlag(AREA, companyId)) return;

  const employees = await selectRows<EmployeeRow>("employees", companyId);
  if (employees.length === 0) return;

  const db = await getDb();
  const members = await membersByRole(companyId);
  const hrUser = memberFor(members, "rh", "admin", "ceo");

  // ---- Dados de admissão de quem ainda não tem (rg IS NULL: não sobrescreve o que o RH já preencheu) -----------
  for (const [index, employee] of employees.entries()) {
    const docs = documentsFor(index);
    await db.execute(
      "UPDATE employees SET document=?, rg=?, pis=?, phone=?, birth_date=?, contract_type=?, address_json=?, emergency_contact_name=?, emergency_contact_phone=? WHERE company_id=? AND id=? AND rg IS NULL",
      [
        docs.document,
        docs.rg,
        docs.pis,
        docs.phone,
        docs.birth_date,
        index % 7 === 6 ? "pj" : "clt",
        addressFor(index),
        EMERGENCY[index % EMERGENCY.length],
        `(15) 9${pad(7200 + index * 31, 4)}-${pad(2000 + index * 53, 4)}`,
        companyId,
        employee.id,
      ],
    );
  }

  // ---- Admissão em andamento e desligamento ---------------------------------------------------------------------
  const newHire = documentsFor(employees.length);
  const leaver = documentsFor(employees.length + 1);
  await insertRows("employees", companyId, [
    {
      id: "dev-hr-emp-1",
      user_id: null,
      name: "Rafael Souza",
      email: "rafael.souza@empresa.local",
      department: "TI / Operações",
      position: "Técnico de suporte",
      hire_date: day(5),
      vacation_days_entitled: 30,
      status: "ativo",
      contract_type: "clt",
      daily_minutes: 480,
      ...newHire,
      address_json: addressFor(employees.length),
      emergency_contact_name: "Cláudia Souza",
      emergency_contact_phone: "(15) 99777-4410",
      notes: "Admissão em andamento: começa na próxima semana.",
    },
    {
      id: "dev-hr-emp-2",
      user_id: null,
      name: "Marcos Vieira",
      email: "marcos.vieira@empresa.local",
      department: "Estoque",
      position: "Auxiliar de estoque",
      hire_date: day(-540),
      vacation_days_entitled: 30,
      status: "desligado",
      contract_type: "clt",
      daily_minutes: 480,
      ...leaver,
      address_json: addressFor(employees.length + 1),
      emergency_contact_name: "Sônia Vieira",
      emergency_contact_phone: "(15) 99654-2231",
      termination_date: day(-10),
      termination_reason: "Pedido de demissão",
      notes: null,
    },
  ]);
  const admission: [string, number, string][] = [
    ["Receber documentos pessoais (RG, CPF, PIS, comprovante de endereço)", -3, "concluida"],
    ["Agendar exame admissional", -1, "concluida"],
    ["Assinar contrato de trabalho", 3, "pendente"],
    ["Criar acessos (e-mail e sistema) e entregar equipamentos", 5, "pendente"],
  ];
  const termination: [string, number, string][] = [
    ["Recolher notebook, crachá e chaves", -10, "concluida"],
    ["Desativar acessos ao sistema e ao e-mail", -10, "concluida"],
    ["Agendar exame demissional e homologação", 2, "pendente"],
  ];
  await insertRows("hr_tasks", companyId, [
    ...admission.map(([title, due, status], index) => ({ id: `dev-hr-task-admissao-${index + 1}`, employee_id: "dev-hr-emp-1", title, description: null, due_date: day(due), status, category: "admissao", created_by: hrUser })),
    ...termination.map(([title, due, status], index) => ({ id: `dev-hr-task-desligamento-${index + 1}`, employee_id: "dev-hr-emp-2", title, description: null, due_date: day(due), status, category: "desligamento", created_by: hrUser })),
  ]);

  // ---- Banco de horas: extras (+) e compensações (−), pendentes e já decididas ------------------------------
  const active = employees.filter((employee) => (employee.status ?? "ativo") !== "desligado");
  const withAccount = active.filter((employee) => employee.user_id);
  const pool = withAccount.length > 0 ? withAccount : active;
  if (pool.length > 0) {
    const entries: [minutes: number, offset: number, reason: string, status: "pendente" | "aprovada" | "recusada"][] = [
      [120, -12, "Atendimento emergencial fora do horário", "aprovada"],
      [90, -9, "Inventário no sábado", "aprovada"],
      [-240, -6, "Saída antecipada (compensação)", "aprovada"],
      [60, -4, "Reunião com cliente após o expediente", "pendente"],
      [180, -3, "Implantação no fim de semana", "pendente"],
      [-60, -2, "Consulta médica (compensação)", "recusada"],
      [45, -1, "Fechamento do mês", "pendente"],
      [150, -15, "Virada de servidor", "aprovada"],
    ];
    await insertRows("hr_time_entries", companyId, entries.map(([minutes, offset, reason, status], index) => ({
      id: `dev-hr-time-${index + 1}`,
      employee_id: pool[index % pool.length].id,
      entry_date: day(offset),
      minutes,
      reason,
      status,
      decided_by: status === "pendente" ? null : hrUser,
      decided_at: status === "pendente" ? null : ts(offset + 1),
      created_by: pool[index % pool.length].user_id ?? hrUser,
      created_at: ts(offset, 18),
    })));
  }

  await setSeedFlag(AREA, companyId);
}
