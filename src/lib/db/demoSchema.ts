// Schema do banco demo do navegador lido das próprias migrations (src-tauri/migrations/*.sql): tabelas, colunas
// e DEFAULT. Assim o demo nunca fica para trás do SQLite: tabela ou coluna nova numa migration já existe no demo.
// Puro (sem localStorage nem import.meta) para poder ser comparado com o SQLite real nos testes.

/** Valor do DEFAULT de uma coluna, calculado na hora (datetime('now') = agora). */
export type DefaultValue = () => unknown;

export type DemoSchema = Map<string, Map<string, DefaultValue>>;

const NULL_DEFAULT: DefaultValue = () => null;

/** Instante atual em ISO (o demo grava timestamps como o resto do seed: toISOString). */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Data de hoje em UTC ('YYYY-MM-DD'), como o date('now') do SQLite. */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function stripComments(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'|--[^\n]*/g, (match) => (match.startsWith("--") ? "" : match));
}

/** Divide por vírgula de nível zero (fora de parênteses e de aspas simples). */
export function splitTopLevel(text: string, separator = ","): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "'") {
      if (quoted && text[index + 1] === "'") {
        current += "''";
        index++;
        continue;
      }
      quoted = !quoted;
    } else if (!quoted && char === "(") depth++;
    else if (!quoted && char === ")") depth--;
    if (!quoted && depth === 0 && text.startsWith(separator, index)) {
      parts.push(current);
      current = "";
      index += separator.length - 1;
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

/** Converte a expressão do DEFAULT em função. Expressão que o demo não sabe calcular vira NULL. */
export function parseDefault(expression: string): DefaultValue {
  const text = expression.trim().replace(/^\((.*)\)$/s, "$1").trim();
  const lower = text.toLowerCase();
  if (lower === "null") return NULL_DEFAULT;
  if (lower === "datetime('now')" || lower === "current_timestamp") return nowIso;
  if (lower === "date('now')" || lower === "current_date") return todayUtc;
  if (lower === "true") return () => 1;
  if (lower === "false") return () => 0;
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    const value = Number(text);
    return () => value;
  }
  const literal = text.match(/^'((?:[^']|'')*)'$/s);
  if (literal) {
    const value = literal[1].replace(/''/g, "'");
    return () => value;
  }
  return NULL_DEFAULT;
}

const CONSTRAINT = /^(primary|unique|foreign|check|constraint)\b/i;

/** Extrai o DEFAULT de uma definição de coluna ("status TEXT NOT NULL DEFAULT 'aberta'"). */
function columnDefault(definition: string): DefaultValue {
  const match = definition.match(/\bdefault\s+(\((?:[^()']|'(?:[^']|'')*'|\([^()]*\))*\)|'(?:[^']|'')*'|[-\w.]+)/i);
  return match ? parseDefault(match[1]) : NULL_DEFAULT;
}

/** Lê CREATE TABLE e ALTER TABLE ... ADD COLUMN de todas as migrations, na ordem recebida. */
export function parseMigrations(sources: readonly string[]): DemoSchema {
  const schema: DemoSchema = new Map();
  for (const source of sources) {
    const sql = stripComments(source);
    for (const statement of splitTopLevel(sql, ";")) {
      const create = statement.match(/^create\s+table\s+(?:if\s+not\s+exists\s+)?(\w+)\s*\(([\s\S]*)\)\s*$/i);
      if (create) {
        const columns = schema.get(create[1]) ?? new Map<string, DefaultValue>();
        for (const definition of splitTopLevel(create[2])) {
          if (CONSTRAINT.test(definition)) continue;
          const name = definition.match(/^"?(\w+)"?/)?.[1];
          if (name) columns.set(name, columnDefault(definition));
        }
        schema.set(create[1], columns);
        continue;
      }
      const alter = statement.match(/^alter\s+table\s+(\w+)\s+add\s+(?:column\s+)?"?(\w+)"?([\s\S]*)$/i);
      if (alter) {
        const columns = schema.get(alter[1]) ?? new Map<string, DefaultValue>();
        columns.set(alter[2], columnDefault(alter[3]));
        schema.set(alter[1], columns);
      }
    }
  }
  return schema;
}
