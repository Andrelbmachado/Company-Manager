import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

/** Atraso da dica ao passar o mouse (no foco pelo teclado ela aparece na hora). */
const HOVER_DELAY_MS = 250;
const TRIGGER = "[data-rail-tip]";

interface Tip {
  label: string;
  top: number;
  left: number;
}

/**
 * Dicas do trilho de ícones (sidebar recolhida): cada controle marcado com `data-rail-tip="<nome>"` mostra o nome
 * ao lado, ao passar o mouse ou focar pelo teclado. Uma só dica, em portal com posição fixa: a lista de módulos rola
 * (overflow) e cortaria uma dica posicionada dentro dela. O nome acessível continua no próprio controle (aria-label
 * ou texto sr-only); a dica é só visual.
 */
export function RailTooltips({ container, enabled }: { container: RefObject<HTMLElement>; enabled: boolean }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const root = container.current;
    if (!root || !enabled) {
      setTip(null);
      return;
    }
    const scope: HTMLElement = root;
    let pointerDown = false;
    const cancel = () => window.clearTimeout(timer.current);
    const hide = () => {
      cancel();
      setTip(null);
    };
    const triggerOf = (node: EventTarget | null) => (node instanceof Element ? node.closest<HTMLElement>(TRIGGER) : null);
    const show = (trigger: HTMLElement) => {
      const label = trigger.getAttribute("data-rail-tip");
      if (!label || !scope.contains(trigger)) return;
      // Ao lado do trilho (não do controle): a dica não cobre a borda da sidebar.
      const rect = trigger.getBoundingClientRect();
      setTip({ label, top: rect.top + rect.height / 2, left: Math.max(rect.right, scope.getBoundingClientRect().right) + 6 });
    };

    function onPointerOver(event: PointerEvent) {
      const trigger = triggerOf(event.target);
      if (!trigger || triggerOf(event.relatedTarget) === trigger) return;
      cancel();
      timer.current = window.setTimeout(() => show(trigger), HOVER_DELAY_MS);
    }
    function onPointerOut(event: PointerEvent) {
      const trigger = triggerOf(event.target);
      if (trigger && triggerOf(event.relatedTarget) !== trigger) hide();
    }
    function onPointerDown() {
      pointerDown = true;
      hide();
    }
    function onPointerUp() {
      pointerDown = false;
    }
    // Foco vindo do clique não mostra a dica (o clique abre o item ou o menu); só o foco pelo teclado.
    function onFocusIn(event: FocusEvent) {
      const trigger = triggerOf(event.target);
      if (!trigger || pointerDown) return hide();
      cancel();
      show(trigger);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") hide();
    }

    scope.addEventListener("pointerover", onPointerOver);
    scope.addEventListener("pointerout", onPointerOut);
    scope.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    scope.addEventListener("focusin", onFocusIn);
    scope.addEventListener("focusout", hide);
    scope.addEventListener("scroll", hide, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancel();
      scope.removeEventListener("pointerover", onPointerOver);
      scope.removeEventListener("pointerout", onPointerOut);
      scope.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      scope.removeEventListener("focusin", onFocusIn);
      scope.removeEventListener("focusout", hide);
      scope.removeEventListener("scroll", hide, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [container, enabled]);

  if (!tip) return null;
  return createPortal(
    <div
      role="tooltip"
      data-rail-tooltip=""
      style={{ top: tip.top, left: tip.left }}
      className="pointer-events-none fixed z-[60] -translate-y-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md"
    >
      {tip.label}
    </div>,
    document.body,
  );
}
