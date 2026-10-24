// Erros da importação: o do arquivo inteiro (não deu para ler) e os de cada linha (relatório).

/** O arquivo não pôde ser lido (vazio, formato errado, grande demais). A mensagem já é a que a pessoa vê. */
export class ImportFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportFileError";
  }
}

/** Erro de uma linha. `row` = número da linha na planilha (cabeçalho = 1); 0 = o lote todo. `field` = chave do campo. */
export interface ImportRowError {
  row: number;
  field: string;
  message: string;
  /** Valor recebido na célula (para o relatório). */
  value?: string;
}

/** Texto para quem não sabe o que é exceção: a mensagem do erro, sem "Error:" na frente. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Erro desconhecido";
}

function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * Relatório de erros em CSV (separador ";", BOM UTF-8 para o Excel abrir com acento).
 * `labelOf` troca a chave do campo pelo rótulo da planilha.
 */
export function errorsToCsv(errors: readonly ImportRowError[], labelOf: (field: string) => string = (field) => field): string {
  const lines = [["Linha", "Campo", "Valor", "Problema"].join(";")];
  for (const error of errors) {
    lines.push([String(error.row || ""), error.field ? labelOf(error.field) : "", error.value ?? "", error.message].map(csvCell).join(";"));
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}
