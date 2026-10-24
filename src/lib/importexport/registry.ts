// Registro das entidades importáveis/exportáveis. Cada arquivo src/lib/importexport/importers/<chave>.ts exporta
// `export const entity: ImportEntity<Linha> = { key: "<chave>", ... }` e entra aqui sozinho (import.meta.glob):
// nenhum arquivo compartilhado precisa mudar para registrar uma entidade nova.
// Chaves: customers, contacts, leads, opportunities, products, suppliers, inventory, employees, payables,
// receivables, tickets, projects. A chave do arquivo e `entity.key` têm de ser iguais (há teste).
// Utilitários dos importers ficam fora de importers/ (tableEntity.ts, write.ts): tudo ali dentro tem de ser entidade.
import type { ZodType } from "zod";
import type { DatabaseLike } from "@/lib/db/demo";
import type { Resource } from "@/lib/permissions/rbac";
import type { WriteJournal } from "./write";

/** Tipos que o normalizador converte a partir do texto da planilha (normalizeValue). */
export type NormalizeKind = "money" | "date" | "int" | "bool" | "phone" | "cnpj" | "cpf" | "email";

/** text = texto livre; number = decimal; enum = um de `options`; document = CPF ou CNPJ; month = competência 'YYYY-MM'. */
export type FieldKind = NormalizeKind | "text" | "number" | "enum" | "document" | "month";

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldDef {
  /** Coluna/campo gravado (snake_case, igual ao banco). */
  key: string;
  /** Cabeçalho em pt-BR usado no modelo e na sugestão de mapeamento. */
  label: string;
  kind: FieldKind;
  required?: boolean;
  /** Outros nomes de coluna aceitos na sugestão automática (ex.: ["razão social", "empresa"]). */
  aliases?: string[];
  /** Valores aceitos quando kind = "enum". */
  options?: FieldOption[];
  /** Valor da linha de exemplo do modelo. */
  example?: string;
  /** Dica curta mostrada no mapeamento. */
  hint?: string;
}

/** Problema de uma linha achado na conferência com o banco (`index` = posição em `rows`). */
export interface RowIssue {
  index: number;
  field: string;
  message: string;
  /** Outra linha envolvida (ex.: a primeira com a mesma chave); o relatório mostra o número dela. */
  relatedIndex?: number;
}

/** Contexto da gravação, montado por runImport. */
export interface UpsertContext {
  /** Simulação: calcula novos/atualizados sem gravar nada. */
  dryRun?: boolean;
  /** Diário para desfazer tudo se a gravação falhar no meio (ver write.ts). */
  journal?: WriteJournal;
  /** Lote de importação (origem de movimentações de estoque etc.). */
  batchId?: string;
  /** Quem importa (opened_by, user_id...). */
  userId?: string | null;
  /** Progresso da gravação (linhas gravadas até agora). */
  onProgress?: (done: number, total: number) => void;
}

export interface ImportEntity<T> {
  key: string;
  label: string;
  /** Frase curta para a escolha da entidade na tela de importação. */
  description?: string;
  /** Recurso do RBAC: importar exige `create` nele (e `view` em `imports` para abrir a tela). */
  resource: Resource;
  fields: FieldDef[];
  schema: ZodType<T>;
  /** Chave natural para atualizar em vez de duplicar (ex.: documento ou e-mail do cliente, SKU do produto). */
  naturalKey: (row: T) => string;
  upsert(db: DatabaseLike, companyId: string, rows: T[], context?: UpsertContext): Promise<{ inserted: number; updated: number }>;
  /** Conferência com o banco antes de gravar (cliente informado existe, nome ambíguo...). Linhas com problema não gravam. */
  check?(db: DatabaseLike, companyId: string, rows: T[]): Promise<RowIssue[]>;
  /** Linhas para exportar: chaves de `fields`, valores crus (número, 'YYYY-MM-DD', booleano, texto ou valor do enum). */
  exportData?(db: DatabaseLike, companyId: string): Promise<Record<string, unknown>[]>;
}

const modules = import.meta.glob<{ entity?: ImportEntity<unknown> }>(["./importers/*.ts", "!./importers/*.test.ts"], { eager: true });

/** Chave do arquivo ("./importers/customers.ts" → "customers"). */
export function importerFileKey(file: string): string {
  return file.replace(/^.*\//, "").replace(/\.ts$/, "");
}

// `any`: cada entidade tem o seu tipo de linha; quem usa uma entidade específica importa o tipo dela.
export const registry: Record<string, ImportEntity<any>> = Object.fromEntries(
  Object.entries(modules)
    .filter(([, module]) => module.entity)
    .map(([, module]) => [module.entity!.key, module.entity!] as const)
    .sort(([a], [b]) => a.localeCompare(b))
);

/** Arquivos de importer encontrados (para o teste de consistência). */
export const importerFiles: Record<string, { entity?: ImportEntity<unknown> }> = modules;

/** Entidade do registro (ou undefined, se a chave não existe). */
export function getEntity(key: string): ImportEntity<any> | undefined {
  return Object.prototype.hasOwnProperty.call(registry, key) ? registry[key] : undefined;
}
