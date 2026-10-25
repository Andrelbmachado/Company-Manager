// Peças de zod para os importers, com mensagens em pt-BR. Os valores já chegam normalizados (normalize.ts):
// texto aparado, número, 'YYYY-MM-DD', booleano, valor do enum. Célula vazia não chega (o campo fica ausente).
import { z } from "zod";

export const text = (max = 255) => z.string().max(max, `Use no máximo ${max} caracteres`);
export const optionalText = (max = 255) => text(max).optional();
export const requiredText = (max = 255) => z.string().min(1, "Campo obrigatório").max(max, `Use no máximo ${max} caracteres`);

export const money = (options: { min?: number; positive?: boolean } = {}) => {
  let schema = z.number({ invalid_type_error: "Valor inválido" }).finite("Valor inválido").max(999_999_999_999, "Valor alto demais");
  if (options.positive) schema = schema.positive("O valor tem de ser maior que zero");
  else if (options.min !== undefined) schema = schema.min(options.min, `O valor mínimo é ${options.min}`);
  return schema;
};

export const decimal = (min?: number, max?: number) => {
  let schema = z.number({ invalid_type_error: "Número inválido" }).finite("Número inválido");
  if (min !== undefined) schema = schema.min(min, `O mínimo é ${String(min).replace(".", ",")}`);
  if (max !== undefined) schema = schema.max(max, `O máximo é ${String(max).replace(".", ",")}`);
  return schema;
};

export const integer = (min?: number, max?: number) => decimal(min, max).int("Use um número inteiro");

export const isoDate = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida");
export const isoMonth = () => z.string().regex(/^\d{4}-\d{2}$/, "Competência inválida");
export const bool = () => z.boolean({ invalid_type_error: "Use Sim ou Não" });

export function oneOf<const T extends readonly [string, ...string[]]>(values: T) {
  return z.enum(values as unknown as [T[number], ...T[number][]], { errorMap: () => ({ message: `Use um destes: ${values.join(", ")}` }) });
}

/** Mensagens padrão do zod em pt-BR, para o que os importers não escreveram à mão. */
export const ptBrErrorMap: z.ZodErrorMap = (issue, context) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      return { message: issue.received === "undefined" ? "Campo obrigatório" : "Valor inválido" };
    case z.ZodIssueCode.too_small:
      return { message: issue.type === "string" ? "Campo obrigatório" : `O mínimo é ${String(issue.minimum)}` };
    case z.ZodIssueCode.too_big:
      return { message: issue.type === "string" ? `Use no máximo ${String(issue.maximum)} caracteres` : `O máximo é ${String(issue.maximum)}` };
    case z.ZodIssueCode.invalid_enum_value:
      return { message: `Use um destes: ${issue.options.join(", ")}` };
    case z.ZodIssueCode.invalid_string:
      return { message: "Formato inválido" };
    default:
      return { message: context.defaultError };
  }
};
