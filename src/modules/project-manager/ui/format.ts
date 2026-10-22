const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatCurrency(value: number): string {
  return currency.format(value);
}

/** "YYYY-MM-DD" ou ISO → "dd/mm/aaaa" sem deslocar o dia por fuso. */
export function formatDay(date: string | null | undefined): string {
  if (!date) return "—";
  const [year, month, day] = date.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : date;
}

/** "YYYY-MM-DD" ou ISO → "dd/mm". */
export function formatShortDay(date: string | null | undefined): string {
  if (!date) return "";
  const [, month, day] = date.slice(0, 10).split("-");
  return month && day ? `${day}/${month}` : date;
}

/** Hoje como "YYYY-MM-DD" no fuso local. */
export function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
