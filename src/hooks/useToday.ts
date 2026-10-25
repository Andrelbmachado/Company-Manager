// Dia local de hoje ('YYYY-MM-DD') que vira sozinho à meia-noite. Tela que calcula "hoje", "a semana" ou "o mês" no
// render (ex.: chave de consulta do Dashboard) e fica aberta de um dia para o outro mostraria o dia anterior até
// alguém trocar de página: aqui o dia é conferido a cada minuto e quando a janela volta a ter foco.
import { useEffect, useState } from "react";
import { todayIso } from "@/lib/utils";

export function useToday(checkEveryMs = 60_000): string {
  const [today, setToday] = useState(() => todayIso());
  useEffect(() => {
    // Mesmo texto = mesmo estado: o React não renderiza de novo enquanto o dia não muda.
    const check = () => setToday(todayIso());
    const timer = window.setInterval(check, checkEveryMs);
    window.addEventListener("focus", check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [checkEveryMs]);
  return today;
}
