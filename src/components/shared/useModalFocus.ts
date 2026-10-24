import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Modais abertos, do mais antigo ao mais novo. */
const openModals: symbol[] = [];

/**
 * Comportamento de modal acessível: o foco entra no painel, Tab fica preso nele, Esc fecha e o foco volta
 * para quem abriu. O painel precisa ter role="dialog" e aria-modal no elemento da ref.
 */
export function useModalFocus<T extends HTMLElement>(onClose: () => void): RefObject<T> {
  const panel = useRef<T>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const id = Symbol("modal");
    openModals.push(id);
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = panel.current?.querySelector<HTMLElement>("input, select, textarea") ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();

    function onKeyDown(event: KeyboardEvent) {
      // Modal aberto sobre outro (ex.: pré-visualização sobre o detalhe): só o de cima responde a Esc e Tab.
      if (openModals[openModals.length - 1] !== id) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== "Tab" || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      openModals.splice(openModals.indexOf(id), 1);
      opener?.focus();
    };
  }, []);

  return panel;
}
