import type { DatabaseLike } from "@/lib/db/demo";
import { nextSequenceNumber, type SequenceTable } from "@/lib/db/sequence";

/**
 * Grava um documento numerado com o próximo número da empresa. Se outra gravação pegou o mesmo número
 * (UNIQUE(company_id, number) recusa), tenta o seguinte, até 3 vezes.
 */
export async function insertWithNextNumber(
  db: DatabaseLike,
  table: SequenceTable,
  companyId: string,
  insert: (number: number) => Promise<unknown>,
): Promise<number> {
  for (let attempt = 0; ; attempt++) {
    const number = await nextSequenceNumber(db, table, companyId);
    try {
      await insert(number);
      return number;
    } catch (error) {
      if (attempt >= 2 || !/unique/i.test(String((error as Error)?.message ?? error))) throw error;
    }
  }
}
