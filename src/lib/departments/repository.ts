/**
 * Camada de acesso a dados dos departamentos. TODA leitura/escrita passa por
 * assertCanDepartment antes de tocar no banco, e os dados de grants cruzados
 * vêm de uma VIEW com colunas limitadas (v_rh_ferias_ausencias_compartilhado),
 * nunca da tabela completa.
 */
import { getDb } from "@/lib/db/client";
import { assertCanDepartment, membershipFor, type AccessContext } from "./access";

export interface AbsenceRow {
  id?: string;
  colaborador_nome: string;
  tipo: string;
  data_inicio: string;
  data_fim: string;
  motivo?: string | null;
  status?: string;
}

export async function listTeamAbsences(ctx: AccessContext, companyId: string): Promise<AbsenceRow[]> {
  assertCanDepartment(ctx, "rh", "view", "ferias_ausencias");
  const db = await getDb();
  if (ctx.isAdmin || membershipFor(ctx, "rh")) {
    return db.select<AbsenceRow[]>(
      `SELECT id, colaborador_nome, tipo, data_inicio, data_fim, motivo, status
         FROM hr_absences WHERE company_id = ? AND deleted_at IS NULL
        ORDER BY data_inicio`,
      [companyId]
    );
  }
  // Acesso via grant: somente a view limitada (sem motivo/atestado/status interno).
  return db.select<AbsenceRow[]>(
    `SELECT colaborador_nome, tipo, data_inicio, data_fim
       FROM v_rh_ferias_ausencias_compartilhado WHERE company_id = ?
      ORDER BY data_inicio`,
    [companyId]
  );
}

export async function createAbsence(
  ctx: AccessContext,
  companyId: string,
  row: Omit<AbsenceRow, "id"> & { id: string }
): Promise<void> {
  assertCanDepartment(ctx, "rh", "create", "ferias_ausencias");
  const db = await getDb();
  await db.execute(
    `INSERT INTO hr_absences (id, company_id, colaborador_nome, tipo, data_inicio, data_fim, motivo)
     VALUES (?,?,?,?,?,?,?)`,
    [row.id, companyId, row.colaborador_nome, row.tipo, row.data_inicio, row.data_fim, row.motivo ?? null]
  );
}
