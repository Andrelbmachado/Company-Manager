import { describe, expect, it } from "vitest";
import { detectDelimiter, parseCsv, toCsv } from "@/lib/csv";

describe("parseCsv", () => {
  it("detects ; (Excel pt-BR) and strips BOM", () => {
    const { headers, rows, delimiter } = parseCsv("﻿Nome;E-mail\r\nAna;ana@x.com\r\n");
    expect(delimiter).toBe(";");
    expect(headers).toEqual(["Nome", "E-mail"]);
    expect(rows).toEqual([["Ana", "ana@x.com"]]);
  });

  it("handles quoted fields with delimiters, quotes and newlines", () => {
    const { rows } = parseCsv('name,notes\n"Silva, João","diz ""oi""\nsegunda linha"\n');
    expect(rows).toEqual([["Silva, João", 'diz "oi"\nsegunda linha']]);
  });

  it("skips blank lines and pads short rows", () => {
    const { rows } = parseCsv("a,b,c\n1,2\n\n4,5,6");
    expect(rows).toEqual([["1", "2", ""], ["4", "5", "6"]]);
  });

  it("detects tabs and commas", () => {
    expect(detectDelimiter("a\tb\tc")).toBe("\t");
    expect(detectDelimiter("a,b,c")).toBe(",");
  });
});

describe("toCsv", () => {
  it("round-trips through parseCsv", () => {
    const text = toCsv(["Nome", "Obs"], [["Ana; Bia", 'x "y"'], ["Carlos", null]]);
    const parsed = parseCsv(text);
    expect(parsed.rows).toEqual([["Ana; Bia", 'x "y"'], ["Carlos", ""]]);
  });
});
