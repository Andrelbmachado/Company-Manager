// TEMPORÁRIO (dados de exemplo): RH e calendário cheios para o modo demonstração. Férias, folgas e atestados aprovados
// espalhados de dois meses atrás a três meses à frente (o calendário mostra quem está ausente e, nos outros dias úteis,
// a presença de cada um), solicitações pendentes e recusadas, pendências do RH e reuniões e eventos no calendário.
// Quem tem conta no app (inclusive a conta de verdade de quem ligou o modo) também ganha solicitações e pendências
// no Meu RH: são registros de exemplo (ids dev-...) que a limpeza apaga, sem mexer no cadastro da pessoa.
// Precisa de colaboradores de exemplo; sem eles não grava nada (nem a flag).
import { zonedInstant } from "@/components/shared/calendar/layout";
import { myHrDemoRows, weekday } from "./myHr";
import { day, exampleRows, hasSeedFlag, insertRows, memberFor, membersByRole, selectRows, setSeedFlag, ts, type SeedRow } from "../seedUtils";

const AREA = "people";

interface EmployeeRow {
  id: string;
  name: string;
  user_id?: string | null;
  status?: string | null;
}

/** Ausências aprovadas por colaborador: [deslocamento do início em dias, duração, tipo]. Variam com a posição. */
const ABSENCE_PLANS: [number, number, "ferias" | "folga" | "atestado" | "outro"][][] = [
  [[-40, 10, "ferias"], [6, 1, "folga"], [47, 1, "atestado"]],
  [[-12, 1, "atestado"], [20, 5, "ferias"], [75, 1, "folga"]],
  [[-55, 1, "folga"], [2, 3, "ferias"], [33, 1, "outro"]],
  [[-25, 5, "ferias"], [13, 1, "folga"], [60, 10, "ferias"]],
  [[-5, 2, "atestado"], [27, 1, "folga"], [88, 15, "ferias"]],
  [[-33, 1, "outro"], [9, 10, "ferias"], [52, 1, "atestado"]],
];
const REASONS: Record<string, string | null> = { ferias: null, folga: "Compromisso pessoal", atestado: "Consulta médica", outro: "Curso externo" };

const MEETINGS: [string, number, number, number, string | null][] = [
  // [título, dia (deslocamento), início em minutos, duração em minutos, local]
  ["Reunião de alinhamento semanal", 0, 9 * 60, 60, "Sala de reuniões"],
  ["Revisão do funil comercial", 1, 14 * 60, 90, null],
  ["Planejamento do mês", 3, 10 * 60, 120, "Sala de reuniões"],
  ["Visita técnica NorteLog", 4, 8 * 60 + 30, 180, "NorteLog Transportes"],
  ["Entrevista: técnico de campo", 6, 15 * 60, 60, "Sala 2"],
  ["Reunião de alinhamento semanal", 7, 9 * 60, 60, "Sala de reuniões"],
  ["Apresentação de proposta - Hospital São Lucas", 9, 11 * 60, 60, "Hospital São Lucas"],
  ["Fechamento financeiro", 12, 16 * 60, 90, null],
  ["Reunião de alinhamento semanal", 14, 9 * 60, 60, "Sala de reuniões"],
  ["Treinamento de atendimento", 16, 13 * 60 + 30, 150, "Auditório"],
  ["Reunião de alinhamento semanal", -7, 9 * 60, 60, "Sala de reuniões"],
  ["Retrospectiva do projeto Wi-Fi", -4, 15 * 60, 60, null],
  ["Reunião com contador", -2, 10 * 60, 60, "Escritório contábil"],
  ["Reunião de alinhamento semanal", 21, 9 * 60, 60, "Sala de reuniões"],
  ["Comitê de compras", 23, 14 * 60, 60, null],
];
const COMPANY_EVENTS: [string, number, number, "evento" | "ausencia"][] = [
  // [título, dia (deslocamento), duração em dias, tipo]
  ["Inventário do estoque", 10, 1, "evento"],
  ["Feira de tecnologia (equipe comercial)", 18, 2, "evento"],
  ["Ponto facultativo", 26, 1, "ausencia"],
  ["Confraternização da equipe", 40, 1, "evento"],
  ["Dedetização do escritório (expediente remoto)", -9, 1, "ausencia"],
];

export async function seed(companyId: string): Promise<void> {
  if (await hasSeedFlag(AREA, companyId)) return;
  const examples = (await exampleRows<EmployeeRow>("employees", companyId)).filter((employee) => employee.status !== "desligado");
  if (examples.length === 0) return;

  const members = await membersByRole(companyId);
  const rh = memberFor(members, "rh", "admin", "ceo");
  const manager = memberFor(members, "gerente", "ceo", "admin");

  // ---- Ausências aprovadas de todos (calendário) -------------------------------------------------------------------
  const requests: SeedRow[] = [];
  examples.forEach((employee, index) => {
    for (const [offset, length, type] of ABSENCE_PLANS[index % ABSENCE_PLANS.length]) {
      const start = weekday(offset + (index % 3));
      requests.push({
        id: `dev-people-absence-${employee.id}-${start}`,
        employee_id: employee.id,
        type,
        start_date: day(start),
        end_date: day(start + length - 1),
        days: length,
        reason: REASONS[type],
        status: "aprovada",
        decided_by: rh,
        decided_at: ts(Math.min(start, 0) - 3),
      });
    }
  });

  // ---- Quem tem conta (a pessoa logada inclusive): solicitações e pendências no Meu RH --------------------------------
  const withAccount = (await selectRows<EmployeeRow>("employees", companyId)).filter((employee) => employee.user_id && employee.status !== "desligado");
  const tasks: SeedRow[] = [];
  withAccount.forEach((employee, index) => {
    const personal = myHrDemoRows(employee.id, index, rh);
    requests.push(...personal.requests);
    tasks.push(...personal.tasks);
  });
  await insertRows("hr_requests", companyId, requests);
  await insertRows("hr_tasks", companyId, tasks);

  // ---- Calendário: reuniões e eventos da empresa ---------------------------------------------------------------------
  const owners = [manager, ...withAccount.map((employee) => employee.user_id ?? null)].filter(Boolean) as string[];
  const events: SeedRow[] = MEETINGS.map(([title, offset, start, duration, location], index) => ({
    id: `dev-people-meeting-${index + 1}`,
    source_id: null,
    uid: null,
    title,
    starts_at: zonedInstant(day(offset), start),
    ends_at: zonedInstant(day(offset), start + duration),
    all_day: 0,
    location,
    description: null,
    user_id: title.startsWith("Reunião de alinhamento") ? null : (owners[index % Math.max(owners.length, 1)] ?? null),
    kind: "reuniao",
  }));
  COMPANY_EVENTS.forEach(([title, offset, length, kind], index) => {
    events.push({ id: `dev-people-event-${index + 1}`, source_id: null, uid: null, title, starts_at: day(offset), ends_at: day(offset + length), all_day: 1, location: null, description: null, user_id: null, kind });
  });
  await insertRows("calendar_events", companyId, events);

  await setSeedFlag(AREA, companyId);
}
