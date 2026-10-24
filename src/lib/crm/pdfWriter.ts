// Gerador mínimo de PDF 1.4 (sem dependência): páginas A4 com texto em Helvetica/Helvetica-Bold (WinAnsiEncoding,
// que cobre os acentos do português), linhas e retângulos. Suficiente para propostas e relatórios simples; o arquivo
// sai pronto para baixar, anexar ou imprimir, no navegador e no app desktop (sem depender da impressão do webview).

/** A4 em pontos (1/72 pol.). */
export const A4 = { width: 595.28, height: 841.89 } as const;

// Larguras (1/1000 em) dos glifos ASCII 32..126 das fontes padrão (AFM da Adobe).
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/** Caracteres fora do Latin-1 que o WinAnsi (cp1252) tem em 0x80..0x9F. */
const CP1252: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e,
  "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
};

function winAnsiCode(char: string): number {
  const code = char.codePointAt(0) ?? 0x3f;
  if (code === 0x09) return 0x20;
  if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) return code;
  return CP1252[char] ?? 0x3f;
}

/** Texto → bytes WinAnsi (o que não existe na fonte vira "?"). */
export function encodeWinAnsi(text: string): Uint8Array {
  return Uint8Array.from(Array.from(text.normalize("NFC"), winAnsiCode));
}

function glyphWidth(char: string, bold: boolean): number {
  const table = bold ? HELVETICA_BOLD : HELVETICA;
  const code = char.codePointAt(0) ?? 0;
  if (code >= 32 && code <= 126) return table[code - 32];
  // Acentuadas têm a largura da letra base (á = a).
  const base = char.normalize("NFD")[0];
  const baseCode = base.codePointAt(0) ?? 0;
  if (base !== char && baseCode >= 32 && baseCode <= 126) return table[baseCode - 32];
  return 556;
}

/** Largura do texto em pontos, no tamanho dado. */
export function textWidth(text: string, size: number, bold = false): number {
  let units = 0;
  for (const char of text.normalize("NFC")) units += glyphWidth(char, bold);
  return (units * size) / 1000;
}

/** Quebra o texto em linhas que cabem em `width` (palavra longa demais é cortada). Respeita quebras de linha. */
export function wrapText(text: string, width: number, size: number, bold = false): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, size, bold) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      let rest = word;
      while (textWidth(rest, size, bold) > width) {
        let cut = rest.length - 1;
        while (cut > 1 && textWidth(rest.slice(0, cut), size, bold) > width) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

function latin1(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

/** String literal do PDF: bytes WinAnsi com \, ( e ) escapados. */
function pdfString(text: string): string {
  return `(${latin1(encodeWinAnsi(text)).replace(/[\\()]/g, (char) => `\\${char}`)})`;
}

const num = (value: number) => (Math.round(value * 100) / 100).toString();

export interface TextOptions {
  size?: number;
  bold?: boolean;
  /** Cinza de 0 (preto) a 1 (branco). */
  gray?: number;
  align?: "left" | "right" | "center";
}

export class PdfPage {
  readonly ops: string[] = [];

  /** `y` é a linha de base, medida de baixo para cima (origem do PDF). */
  text(x: number, y: number, value: string, options: TextOptions = {}): void {
    const size = options.size ?? 10;
    const width = textWidth(value, size, options.bold);
    const left = options.align === "right" ? x - width : options.align === "center" ? x - width / 2 : x;
    this.ops.push(`BT /${options.bold ? "F2" : "F1"} ${num(size)} Tf ${num(options.gray ?? 0)} g ${num(left)} ${num(y)} Td ${pdfString(value)} Tj ET`);
  }

  line(x1: number, y1: number, x2: number, y2: number, width = 0.5, gray = 0.75): void {
    this.ops.push(`${num(gray)} G ${num(width)} w ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`);
  }

  rect(x: number, y: number, width: number, height: number, fillGray = 0.93): void {
    this.ops.push(`${num(fillGray)} g ${num(x)} ${num(y)} ${num(width)} ${num(height)} re f`);
  }
}

export class PdfDocument {
  readonly pages: PdfPage[] = [];

  constructor(private readonly info: { title?: string; author?: string } = {}) {}

  addPage(): PdfPage {
    const page = new PdfPage();
    this.pages.push(page);
    return page;
  }

  /** Bytes do arquivo (objetos numerados 1..n, xref com os offsets exatos). */
  toBytes(): Uint8Array<ArrayBuffer> {
    if (this.pages.length === 0) this.addPage();
    const objects: string[] = [];
    const pageCount = this.pages.length;
    // 1 catálogo, 2 árvore de páginas, 3 e 4 fontes, 5 info, depois página + conteúdo de cada página.
    const pageObject = (index: number) => 6 + index * 2;
    objects.push("<< /Type /Catalog /Pages 2 0 R >>");
    objects.push(`<< /Type /Pages /Kids [${this.pages.map((_, index) => `${pageObject(index)} 0 R`).join(" ")}] /Count ${pageCount} >>`);
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const info = [this.info.title ? `/Title ${pdfString(this.info.title)}` : "", this.info.author ? `/Author ${pdfString(this.info.author)}` : "", "/Producer (Company Manager)"].filter(Boolean).join(" ");
    objects.push(`<< ${info} >>`);
    this.pages.forEach((page, index) => {
      const content = page.ops.join("\n");
      objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.width} ${A4.height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageObject(index) + 1} 0 R >>`);
      objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    });

    let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
    const offsets: number[] = [];
    objects.forEach((body, index) => {
      offsets.push(out.length);
      out += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

    // Tudo acima é "latin1" (um char = um byte), então o tamanho em chars é o tamanho em bytes.
    const bytes = new Uint8Array(new ArrayBuffer(out.length));
    for (let index = 0; index < out.length; index++) bytes[index] = out.charCodeAt(index) & 0xff;
    return bytes;
  }
}
