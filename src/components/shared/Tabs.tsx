import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface TabListProps<T extends string> {
  tabs: readonly { readonly id: T; readonly label: ReactNode }[];
  value: T;
  onChange: (id: T) => void;
  /** Nome da lista para leitor de tela e prefixo dos ids (tab-<prefixo>-<id>). */
  label: string;
  idPrefix: string;
}

/** Lista das abas: do tamanho das abas (a linha não ocupa a largura toda) e rola sem barra visível se não couber. */
export const TAB_LIST_CLASS = "flex w-fit max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

/** Aba: texto maior, linha embaixo de cada aba e indicador na ativa (sem margem negativa: nada vaza e cria rolagem). */
export function tabClass(active: boolean): string {
  return cn(
    "shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-base font-semibold transition-colors",
    active ? "border-primary text-foreground" : "border-border text-muted-foreground hover:text-foreground",
  );
}

/** Abas acessíveis: setas e Home/End trocam de aba, só a aba ativa entra na ordem do Tab, aria-controls aponta para o painel. */
export function TabList<T extends string>({ tabs, value, onChange, label, idPrefix }: TabListProps<T>) {
  const refs = useRef(new Map<T, HTMLButtonElement>());

  function onKeyDown(event: KeyboardEvent, current: T) {
    const index = tabs.findIndex((tab) => tab.id === current);
    const next = event.key === "ArrowRight" ? tabs[(index + 1) % tabs.length] : event.key === "ArrowLeft" ? tabs[(index - 1 + tabs.length) % tabs.length] : event.key === "Home" ? tabs[0] : event.key === "End" ? tabs[tabs.length - 1] : null;
    if (!next) return;
    event.preventDefault();
    onChange(next.id);
    refs.current.get(next.id)?.focus();
  }

  return (
    <div role="tablist" aria-label={label} className={TAB_LIST_CLASS}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          ref={(element) => { if (element) refs.current.set(tab.id, element); else refs.current.delete(tab.id); }}
          id={`tab-${idPrefix}-${tab.id}`}
          role="tab"
          aria-selected={value === tab.id}
          aria-controls={`painel-${idPrefix}-${tab.id}`}
          tabIndex={value === tab.id ? 0 : -1}
          onKeyDown={(event) => onKeyDown(event, tab.id)}
          onClick={() => onChange(tab.id)}
          className={tabClass(value === tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ idPrefix, id, children }: { idPrefix: string; id: string; children: ReactNode }) {
  return <div role="tabpanel" id={`painel-${idPrefix}-${id}`} aria-labelledby={`tab-${idPrefix}-${id}`} tabIndex={0} className="space-y-6 outline-none focus-visible:outline-2">{children}</div>;
}
