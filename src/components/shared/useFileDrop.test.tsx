// Guarda de arrastar e soltar: com dragDropEnabled: false (tauri.conf.json), arquivo solto fora de uma área de envio
// faria a webview abrir o arquivo no lugar do app. O guarda cancela isso na janela inteira, desde o início do app.
import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { describe, expect, it } from "vitest";
import { installFileDropGuard } from "./useFileDrop";

function dragEvent(type: string, types: string[]) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const dataTransfer = { types, files: [], dropEffect: "copy" };
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  return { event, dataTransfer };
}

describe("installFileDropGuard", () => {
  it("arquivo arrastado fora de uma área de envio não abre na janela (dragover e drop cancelados, cursor de proibido)", () => {
    installFileDropGuard();
    installFileDropGuard(); // idempotente
    const over = dragEvent("dragover", ["Files"]);
    document.body.dispatchEvent(over.event);
    expect(over.event.defaultPrevented).toBe(true);
    expect(over.dataTransfer.dropEffect).toBe("none");
    const drop = dragEvent("drop", ["Files"]);
    document.body.dispatchEvent(drop.event);
    expect(drop.event.defaultPrevented).toBe(true);
  });

  it("não mexe em arrasto de texto nem no que uma área de envio já tratou", () => {
    installFileDropGuard();
    const textDrag = dragEvent("dragover", ["text/plain"]);
    document.body.dispatchEvent(textDrag.event);
    expect(textDrag.event.defaultPrevented).toBe(false);

    const zone = document.createElement("div");
    document.body.appendChild(zone);
    zone.addEventListener("dragover", (event) => event.preventDefault());
    const handled = dragEvent("dragover", ["Files"]);
    zone.dispatchEvent(handled.event);
    expect(handled.event.defaultPrevented).toBe(true);
    expect(handled.dataTransfer.dropEffect).toBe("copy");
    zone.remove();
  });

  it("o app instala o guarda ao iniciar (main.tsx), não só quando a primeira área de envio aparece", () => {
    const main = readFileSync(fileURLToPath(new NodeURL("../../main.tsx", import.meta.url)), "utf8");
    expect(main).toMatch(/^import \{ installFileDropGuard \} from "\.\/components\/shared\/useFileDrop";$/m);
    expect(main).toMatch(/^installFileDropGuard\(\);$/m);
  });
});
