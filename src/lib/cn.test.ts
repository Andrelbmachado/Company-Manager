// cn() junta classes com o tailwind-merge, que precisa conhecer os tamanhos de texto do tema (tailwind.config.js):
// sem isso, text-body ou text-caption passariam por cor de texto e apagariam text-muted-foreground.
import { describe, expect, it } from "vitest";
import { cn } from "./utils";

const SIZES = ["caption", "callout", "body", "headline", "title3", "title2", "title1", "large-title"];

describe("cn com a tipografia do tema", () => {
  it.each(SIZES)("text-%s é tamanho de texto: não apaga a cor", (size) => {
    expect(cn("text-muted-foreground", `text-${size}`)).toBe(`text-muted-foreground text-${size}`);
  });

  it.each(SIZES)("text-%s substitui outro tamanho (o último vence)", (size) => {
    expect(cn("text-sm", `text-${size}`)).toBe(`text-${size}`);
    expect(cn(`text-${size}`, "text-xs")).toBe("text-xs");
  });
});
