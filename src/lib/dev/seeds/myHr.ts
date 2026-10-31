// TEMPORÁRIO (dados de exemplo): o Meu RH de uma conta no modo demonstração (solicitações pendente, aprovada e recusada,
// atestado e pendências do RH). Usado pelo seed `people` (contas que já têm cadastro) e por ensureMyEmployee (cadastro
// criado depois de ligar o modo). Registros dev-people-* sobre o cadastro da pessoa: a limpeza apaga esses registros e
// não mexe no cadastro. INSERT OR IGNORE: rodar de novo não duplica.
import { day, insertRows, memberFor, membersByRole, ts, type SeedRow } from "../seedUtils";

const PERSONAL_TASKS: [string, number, "pendente" | "concluida"][] = [
  ["Enviar comprovante de endereço atualizado", 4, "pendente"],
  ["Assinar o aditivo do contrato de trabalho", 9, "pendente"],
  ["Concluir o treinamento de segurança da informação", -3, "pendente"],
  ["Atualizar o contato de emergência", -10, "concluida"],
];

/** Deslocamento ajustado para cair num dia útil (sábado e domingo vão para a segunda seguinte). */
export function weekday(offset: number): number {
  const weekDay = new Date(`${day(offset)}T12:00:00Z`).getUTCDay();
  return weekDay === 6 ? offset + 2 : weekDay === 0 ? offset + 1 : offset;
}

/** Solicitações e pendências de exemplo de um colaborador; `index` só espalha as datas entre as pessoas. */
export function myHrDemoRows(employeeId: string, index: number, rh: string | null): { requests: SeedRow[]; tasks: SeedRow[] } {
  const requests: SeedRow[] = [
    { id: `dev-people-request-${employeeId}-1`, employee_id: employeeId, type: "ferias", start_date: day(weekday(35 + index * 3)), end_date: day(weekday(35 + index * 3) + 9), days: 10, reason: "Férias programadas", status: "pendente" },
    { id: `dev-people-request-${employeeId}-2`, employee_id: employeeId, type: "folga", start_date: day(weekday(11 + (index % 5))), end_date: day(weekday(11 + (index % 5))), days: 1, reason: "Banco de horas", status: index % 2 ? "pendente" : "aprovada", decided_by: index % 2 ? null : rh, decided_at: index % 2 ? null : ts(-1) },
    { id: `dev-people-request-${employeeId}-3`, employee_id: employeeId, type: "atestado", start_date: day(weekday(-18 - (index % 4))), end_date: day(weekday(-18 - (index % 4))), days: 1, reason: "Consulta médica", status: "aprovada", decided_by: rh, decided_at: ts(-17) },
    { id: `dev-people-request-${employeeId}-4`, employee_id: employeeId, type: "folga", start_date: day(weekday(-30 + (index % 6))), end_date: day(weekday(-30 + (index % 6))), days: 1, reason: "Mudança de casa", status: "recusada", decided_by: rh, decided_at: ts(-33), decision_note: "Equipe reduzida nesse dia." },
  ];
  const tasks: SeedRow[] = PERSONAL_TASKS.map(([title, due, status], taskIndex) => ({
    id: `dev-people-task-${employeeId}-${taskIndex + 1}`,
    employee_id: employeeId,
    title,
    description: null,
    due_date: day(due + (index % 3)),
    status,
    created_by: rh,
  }));
  return { requests, tasks };
}

/** Meu RH de exemplo de um colaborador (ensureMyEmployee chama com o modo demonstração ligado). */
export async function seedMyHrDemo(companyId: string, employeeId: string): Promise<void> {
  const rh = memberFor(await membersByRole(companyId), "rh", "admin", "ceo");
  const index = [...employeeId].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 6;
  const { requests, tasks } = myHrDemoRows(employeeId, index, rh);
  await insertRows("hr_requests", companyId, requests);
  await insertRows("hr_tasks", companyId, tasks);
}
