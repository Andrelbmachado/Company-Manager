import { useEffect, useRef, useState, type DragEvent } from "react";

const carriesFiles = (event: { dataTransfer?: DataTransfer | null }) => Array.from(event.dataTransfer?.types ?? []).includes("Files");

let guardInstalled = false;

/**
 * Com `dragDropEnabled: false` (tauri.conf.json) o webview recebe o arrasto como no navegador: arquivo solto fora de
 * uma área de envio faria a janela abrir o arquivo no lugar do app. Este guarda cancela isso (uma vez por janela).
 */
export function installFileDropGuard(): void {
  if (guardInstalled || typeof window === "undefined") return;
  guardInstalled = true;
  const cancel = (event: globalThis.DragEvent) => {
    if (!carriesFiles(event) || event.defaultPrevented) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
  };
  window.addEventListener("dragover", cancel);
  window.addEventListener("drop", cancel);
}

/** Área que aceita arquivos arrastados do Finder/Explorer. Espalhe `bind` no elemento e use `isDragging` no visual. */
export function useFileDrop(onFiles: (files: File[]) => void, options: { disabled?: boolean } = {}) {
  const [isDragging, setDragging] = useState(false);
  const depth = useRef(0);
  const handler = useRef(onFiles);
  handler.current = onFiles;

  useEffect(installFileDropGuard, []);
  useEffect(() => {
    if (options.disabled) {
      depth.current = 0;
      setDragging(false);
    }
  }, [options.disabled]);

  const bind = options.disabled
    ? {}
    : {
        onDragEnter(event: DragEvent) {
          if (!carriesFiles(event)) return;
          event.preventDefault();
          depth.current += 1;
          setDragging(true);
        },
        onDragOver(event: DragEvent) {
          if (!carriesFiles(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        },
        onDragLeave(event: DragEvent) {
          if (!carriesFiles(event)) return;
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setDragging(false);
        },
        onDrop(event: DragEvent) {
          if (!carriesFiles(event)) return;
          event.preventDefault();
          event.stopPropagation();
          depth.current = 0;
          setDragging(false);
          const files = Array.from(event.dataTransfer.files ?? []);
          if (files.length > 0) handler.current(files);
        },
      };

  return { isDragging, bind };
}
