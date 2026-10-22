/** Contrato mínimo de banco usado pelo módulo — idêntico ao DatabaseLike do Company Manager. */
export interface DatabaseLike {
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
  execute(query: string, bindValues?: unknown[]): Promise<unknown>;
}
