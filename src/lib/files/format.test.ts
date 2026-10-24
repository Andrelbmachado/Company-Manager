import { describe, expect, it } from "vitest";
import { decodeText, formatBytes, formatTimestamp, guessMime, previewKind, previewMime } from "./format";

describe("decodeText", () => {
  it("UTF-8 sem o BOM; o que não é UTF-8 válido é lido como Windows-1252 (CSV antigo do Excel)", () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("Cotação")]))).toBe("Cotação");
    expect(decodeText(Uint8Array.from([0x43, 0x6f, 0x74, 0x61, 0xe7, 0xe3, 0x6f]))).toBe("Cotação");
  });

  it("começo de um arquivo maior (truncated): caractere cortado no fim não estraga o resto do texto", () => {
    const bytes = new TextEncoder().encode(`a${"ção ".repeat(1000)}`);
    for (const cut of [2, 3, 4, 5, 6, 1001, 2048, 4097]) {
      const head = decodeText(bytes.subarray(0, cut), { truncated: true });
      expect(head, `corte em ${cut}`).not.toContain("Ã");
      expect(head, `corte em ${cut}`).not.toContain("�");
      expect(`a${"ção ".repeat(1000)}`.startsWith(head), `corte em ${cut}`).toBe(true);
    }
    // emoji (4 bytes) cortado em qualquer ponto
    const emoji = new TextEncoder().encode("ok 📎");
    for (let cut = 3; cut <= emoji.length; cut++) {
      expect(decodeText(emoji.subarray(0, cut), { truncated: true })).toBe(cut === emoji.length ? "ok 📎" : "ok ");
    }
  });

  it("arquivo inteiro em Latin-1 terminando em acento continua Windows-1252 (não perde o último caractere)", () => {
    expect(decodeText(Uint8Array.from([0x61, 0xe7]))).toBe("aç");
    expect(decodeText(Uint8Array.from([0x61, 0xe7, 0xe3]), { truncated: true })).toBe("açã");
  });
});

describe("pré-visualização segura", () => {
  it("HTML nunca é pré-visualizado; texto, PDF e imagem sim", () => {
    expect(previewKind({ title: "pagina.html", mime: "text/html" })).toBeNull();
    expect(previewKind({ title: "pagina.htm" })).toBeNull();
    expect(previewKind({ title: "nota.txt", mime: "text/html" })).toBe("text");
    expect(previewKind({ title: "sem-extensao", mime: "application/pdf" })).toBe("pdf");
    expect(previewKind({ title: "logo.svg" })).toBe("image");
    expect(previewKind({ title: "planilha.xlsx" })).toBeNull();
  });

  it("o blob da pré-visualização usa o tipo da pré-visualização, nunca o MIME informado pelo arquivo", () => {
    expect(previewMime("pdf", { title: "fatura.pdf" })).toBe("application/pdf");
    expect(previewMime("text", { title: "nota.txt" })).toBe("text/plain");
    expect(previewMime("image", { title: "foto.JPG" })).toBe("image/jpeg");
    expect(previewMime("image", { title: "logo.svg" })).toBe("image/svg+xml");
  });
});

describe("formatos", () => {
  it("formatBytes em pt-BR; valor inválido vira 0 bytes", () => {
    expect(formatBytes(0)).toBe("0 bytes");
    expect(formatBytes(1)).toBe("1 byte");
    expect(formatBytes(1023)).toBe("1023 bytes");
    expect(formatBytes(1536)).toBe("1,5 KB");
    expect(formatBytes(50 * 1024 * 1024)).toBe("50 MB");
    expect(formatBytes(null)).toBe("0 bytes");
    expect(formatBytes(Number.NaN)).toBe("0 bytes");
    expect(formatBytes(-5)).toBe("0 bytes");
  });

  it("guessMime: usa o informado se bem formado, senão a extensão", () => {
    expect(guessMime("a.pdf", "application/pdf")).toBe("application/pdf");
    expect(guessMime("a.csv", "text/csv; charset=utf-8")).toBe("text/csv");
    expect(guessMime("a.xlsx", "")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(guessMime("a.desconhecida", "não é mime")).toBe("application/octet-stream");
  });

  it("formatTimestamp: datetime('now') do SQLite (UTC sem fuso) e ISO com Z mostram o mesmo instante", () => {
    expect(formatTimestamp("2026-10-24 17:03:00")).toBe(formatTimestamp("2026-10-24T17:03:00.000Z"));
    expect(formatTimestamp(null)).toBe("—");
    expect(formatTimestamp("não é data")).toBe("não é data");
  });
});
