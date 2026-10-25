import { useEffect, useRef, type RefObject } from "react";

/** Fecha um menu suspenso aberto ao clicar fora dele (do `ref`) ou ao apertar Esc. */
export function useDismiss(ref: RefObject<HTMLElement>, open: boolean, onClose: () => void): void {
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) close.current();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close.current();
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, ref]);
}
