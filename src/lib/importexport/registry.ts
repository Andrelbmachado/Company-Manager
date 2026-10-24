// Registro das entidades importáveis/exportáveis. Cada arquivo src/lib/importexport/importers/<chave>.ts exporta
// `export const entity: ImportEntity<Linha> = { key: "<chave>", ... }` e entra aqui sozinho (import.meta.glob):
// nenhum arquivo compartilhado precisa mudar para registrar uma entidade nova.
// Chaves previstas: customers, contacts, leads, opportunities, products, suppliers, inventory, employees, payables,
// receivables, tickets, projects. A chave do arquivo e `entity.key` têm de ser iguais (há teste).
import type { ZodType } from "zod";
import type { DatabaseLike } from "@/lib/db/demo";
import type { Resource } from "@/lib/permissions/rbac";

/** Tipos que o normalizador converte a partir do texto da planilha (normalizeValue). */
export type NormalizeKind = "money" | "date" | "int" | "bool" | "phone" | "cnpj" | "cpf" | "email";

/** text = texto livre; number = decimal; enum = um de `options`; document = CPF ou CNPJ. */
export type FieldKind = NormalizeKind | "text" | "number" | "enum" | "document";

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

export interface ImportEntity<T> {
  key: string;
  label: string;
  /** Recurso do RBAC: importar exige `create` nele (e `view` em `imports` para abrir a tela). */
  resource: Resource;
  fields: FieldDef[];
  schema: ZodType<T>;
  /** Chave natural para atualizar em vez de duplicar (ex.: documento ou e-mail do cliente, SKU do produto). */
  naturalKey: (row: T) => string;
  upsert(db: DatabaseLike, companyId: string, rows: T[]): Promise<{ inserted: number; updated: number }>;
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
