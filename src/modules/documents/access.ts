// Pastas raiz que cada setor enxerga na tela de Documentos. CEO, admin, gerência e auditoria veem todas.
// A comparação ignora acento e maiúsculas: o banco demo grava "TI e Operacoes" e o desktop, "TI e Operações".
import type { Role } from "@/types";

const ROOT_ACCESS: Record<Role, readonly string[] | "*"> = {
  ceo: "*",
  admin: "*",
  gerente: "*",
  auditor: "*",
  rh: ["Recursos Humanos", "Compartilhados"],
  tecnico: ["TI e Operações", "Compartilhados"],
  estoquista: ["Estoque", "Compartilhados"],
  financeiro: ["Financeiro", "Compartilhados"],
  comercial: ["Comercial", "Compartilhados"],
  atendimento: ["Atendimento", "Compartilhados"],
  produtos: ["Desenvolvimento de Produtos", "Compartilhados"],
};

/** Nome comparável: sem acento, minúsculo, sem espaços nas pontas. */
export function foldName(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR").trim();
}

export function visibleRoots(role: Role): readonly string[] | "*" {
  return ROOT_ACCESS[role] ?? [];
}

/** O papel vê esta pasta ("A/B/C")? Decide pela raiz; arquivo solto na raiz ("") só com acesso total. */
export function canSeeFolder(role: Role, folder: string): boolean {
  const roots = visibleRoots(role);
  if (roots === "*") return true;
  const root = folder.split("/")[0] ?? "";
  if (!root) return false;
  return roots.some((allowed) => foldName(allowed) === foldName(root));
}

/** Para onde vai o envio feito na raiz: a pasta do setor, ou Compartilhados para quem vê tudo. */
export function defaultRoot(role: Role): string {
  const roots = visibleRoots(role);
  return roots === "*" ? "Compartilhados" : roots[0] ?? "Compartilhados";
}
