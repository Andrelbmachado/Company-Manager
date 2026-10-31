// TEMPORÁRIO (dados de exemplo): iniciativas de Desenvolvimento de produtos (4 físicas e 4 digitais), guardadas no
// mesmo JSON de `settings` que a tela usa (src/lib/products/initiatives.ts). Ids dev-initiative-N: a limpeza do modo
// demonstração tira só essas do JSON (purge.ts). Sem flag: acrescenta só as que faltam.
import { getDb } from "@/lib/db/client";
import { getCompanySetting, setCompanySetting } from "@/lib/settings/companySettings";
import { INITIATIVES_SETTING, type InitiativeStatus, type InitiativeType } from "@/lib/products/initiatives";
import { day, ts } from "../seedUtils";

const INITIATIVES: [string, InitiativeType, InitiativeStatus, string, string, number][] = [
  // [nome, tipo, status, responsável, próximo marco, dias até o marco]
  ["Roteador corporativo CM-200", "fisico", "em_desenvolvimento", "Aline Rocha", "Protótipo funcional", 12],
  ["Kit de sensores para câmara fria", "fisico", "em_validacao", "Bruno Martins", "Teste de campo no cliente", 20],
  ["Nobreak compacto para PDV", "fisico", "descoberta", "Aline Rocha", "Entrevistas com 5 lojas", 9],
  ["Rack modular de parede", "fisico", "lancado", "Bruno Martins", "Revisão de vendas do trimestre", 35],
  ["Portal do cliente (chamados e faturas)", "digital", "em_desenvolvimento", "Aline Rocha", "Beta com 3 clientes", 16],
  ["App de checklist das OS", "digital", "planejado", "Bruno Martins", "Aprovar escopo", 6],
  ["Painel de monitoramento de rede", "digital", "em_validacao", "Aline Rocha", "Apresentação para a diretoria", 25],
  ["Integração com nota fiscal eletrônica", "digital", "pausado", "Bruno Martins", "Retomar após o fechamento do ano", 60],
];

export async function seed(companyId: string): Promise<void> {
  const db = await getDb();
  const current = await getCompanySetting(db, companyId, INITIATIVES_SETTING);
  const list: { id: string }[] = Array.isArray(current) ? current : [];
  const have = new Set(list.map((item) => item.id));
  const missing = INITIATIVES.map(([name, type, status, owner, milestone, days], index) => ({
    id: `dev-initiative-${index + 1}`,
    name,
    type,
    status,
    owner,
    next_milestone: milestone,
    milestone_date: day(days),
    created_at: ts(-90 + index * 7),
    updated_at: ts(-5 + index),
  })).filter((item) => !have.has(item.id));
  if (missing.length === 0) return;
  await setCompanySetting(db, companyId, INITIATIVES_SETTING, [...list, ...missing]);
}
