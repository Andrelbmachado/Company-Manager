#!/usr/bin/env node
// Gera ~/LeadingSitesSorocaba/PACOTES_PRECOS.md (tabela final de preços + previsão de receita) a partir de
// pricing.mjs e dos leads do seed gerado, para o documento nunca divergir do CRM.
// Uso: node scripts/site-prospecting/export-pacotes.mjs [saida.md]
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MANAGEMENT_SCOPE, PACKAGES, PRICES, SCENARIOS, suggestPackage } from "./pricing.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? resolve(homedir(), "LeadingSitesSorocaba/PACOTES_PRECOS.md");
const src = readFileSync(resolve(here, "../../src/lib/prospecting/data/siteProspecting.generated.ts"), "utf8");
const leads = JSON.parse(src.match(/export const SITE_LEADS: SiteLeadSeed\[\] = (\[[\s\S]*\]);/)[1]);

const brl = (n) => "R$ " + Math.round(n).toLocaleString("pt-BR");
const pair = (v) => `${brl(v[0])} / ${brl(v[1])}`;
const names = Object.fromEntries(PACKAGES.map((p) => [p.code, p.name]));
const segments = Object.keys(PRICES).sort((a, b) => a.localeCompare(b, "pt-BR"));
const pct = (r) => `${Math.round(r * 100)}%`;

// Agrega por segmento de preço.
const bySeg = new Map(segments.map((s) => [s, { n: 0, setup: 0, monthly: 0, revenue: 0, premium: 0 }]));
for (const l of leads) {
  const a = bySeg.get(l.pricing_segment);
  a.n++; a.setup += l.estimated_setup; a.monthly += l.estimated_monthly; a.revenue += l.estimated_revenue;
  if (l.package_code === "premium") a.premium++;
}
const total = [...bySeg.values()].reduce((t, a) => ({ n: t.n + a.n, setup: t.setup + a.setup, monthly: t.monthly + a.monthly, revenue: t.revenue + a.revenue, premium: t.premium + a.premium }), { n: 0, setup: 0, monthly: 0, revenue: 0, premium: 0 });

let md = `# Pacotes e preços — Desenvolvimento de Site

Tabela final dos três pacotes, com os preços fixos da Proposta Comercial, e a previsão de receita recalculada para os 155 leads de Sorocaba. O mesmo conteúdo está no CRM do Company Manager (Prospecção › Pacotes e preços e Previsão de receita).

## 1. Os três pacotes

| Pacote | O que é |
|---|---|
`;
for (const p of PACKAGES) md += `| **${p.name}** | ${p.description.replace(/ Mensalidade com fidelidade mínima de 12 meses\.$/, "")} |\n`;
md += `
O que cada pacote inclui:

`;
for (const p of PACKAGES) md += `**${p.name}**\n${p.features.map((f) => `- ${f}`).join("\n")}\n\n`;

md += `## 2. Preços por segmento (implantação / mensalidade)

Preços **fixos**, definidos na Proposta Comercial: implantação de R$ 1.600 a R$ 12.000, mais mensalidade com **fidelidade mínima de 12 meses**. Mensalidade paga à vista por 12 meses: paga 10 e leva 12. Os valores do Básico, do Essencial e do Premium seguem, na Proposta, as colunas "Básico", "Com funcionalidade-chave" e "Premium com SEO".

| Segmento | ${names.basico} implantação / mensal | ${names.essencial} implantação / mensal | ${names.premium} implantação / mensal |
|---|---|---|---|
`;
for (const s of segments) md += `| ${s} | ${pair(PRICES[s].basico)} | ${pair(PRICES[s].essencial)} | ${pair(PRICES[s].premium)} |\n`;

md += `
### Escopo base do gerenciador (Essencial e Premium)

Buffet, veterinária e restaurante seguem as definições do André; nos demais segmentos é o escopo base, a detalhar com o cliente.

| Segmento | Gerenciador |
|---|---|
`;
for (const s of segments) md += `| ${s} | ${MANAGEMENT_SCOPE[s]} |\n`;

md += `
## 3. Programa de Indicação

Vale para qualquer pacote e **só quando o indicado fecha o negócio** (contrato assinado e pago). Indicação que não fecha não conta nem gera benefício para ninguém.

- Por indicado que fechar: quem indica ganha **1 mês grátis** na mensalidade e o indicado ganha **10% de desconto** no setup.
- Bônus de nível para quem indica: **3 indicados fechados = +1 mês extra**; **5 indicados fechados = +2 meses extras** (os níveis se somam: com 5 fechados, são 5 meses + 1 + 2 = 8 meses grátis).
- No CRM: campo "indicado por", status do benefício (pendente até o fechamento, depois concedido), contagem de indicações fechadas por quem indicou e níveis atingidos.

A redação comercial da seção "Programa de Indicação" da Proposta é feita à parte.

## 4. Previsão de receita (recalculada)

**Como a estimativa é feita**
- Base: ${total.n} leads, todos sem site. Potencial de cada lead = implantação + 12 mensalidades (1º ano) do pacote assumido no segmento do lead.
- Pacote assumido: **Premium** para negócios com 200 ou mais avaliações no Google (${total.premium} leads), **Básico** para os demais (${total.n - total.premium} leads). O Essencial não é assumido, pois ninguém tem site ainda; a tabela do item 4.3 mostra o resultado se todos fechassem cada pacote.
- Cenários: ${SCENARIOS.map((s) => `${pct(s.rate)} (${s.label.split(" ")[0].toLowerCase()})`).join(", ")} dos leads fecham. Descontos e meses grátis do Programa de Indicação não entram na conta.
- Pet shop / banho e tosa / hotel (2 leads) tem preço próprio, separado da veterinária (20 leads), como na Proposta.

### 4.1 Total por cenário

| Cenário | Fechamentos esperados | Implantação | Recorrência mensal (após fechar) | Receita no 1º ano |
|---|---:|---:|---:|---:|
`;
for (const s of SCENARIOS) md += `| ${s.label} | ${(total.n * s.rate).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} | ${brl(total.setup * s.rate)} | ${brl(total.monthly * s.rate)} | **${brl(total.revenue * s.rate)}** |\n`;
md += `| Potencial (100% dos leads) | ${total.n} | ${brl(total.setup)} | ${brl(total.monthly)} | ${brl(total.revenue)} |

### 4.2 Receita no 1º ano por segmento

| Segmento | Leads | Potencial (100%) | ${SCENARIOS.map((s) => pct(s.rate)).join(" | ")} |
|---|---:|---:|${SCENARIOS.map(() => "---:").join("|")}|
`;
for (const [s, a] of [...bySeg.entries()].sort((x, y) => y[1].revenue - x[1].revenue)) md += `| ${s} | ${a.n} | ${brl(a.revenue)} | ${SCENARIOS.map((sc) => brl(a.revenue * sc.rate)).join(" | ")} |\n`;
md += `| **Total** | **${total.n}** | **${brl(total.revenue)}** | ${SCENARIOS.map((sc) => `**${brl(total.revenue * sc.rate)}**`).join(" | ")} |

### 4.3 Se todos os leads fechassem o mesmo pacote (receita no 1º ano)

| Pacote | Potencial (100%) | ${SCENARIOS.map((s) => pct(s.rate)).join(" | ")} |
|---|---:|${SCENARIOS.map(() => "---:").join("|")}|
`;
for (const p of PACKAGES) {
  const rev = leads.reduce((sum, l) => { const [setup, monthly] = PRICES[l.pricing_segment][p.code]; return sum + setup + 12 * monthly; }, 0);
  md += `| ${p.name} | ${brl(rev)} | ${SCENARIOS.map((sc) => brl(rev * sc.rate)).join(" | ")} |\n`;
}
md += `
Gerado a partir do CRM do Company Manager (\`scripts/site-prospecting/export-pacotes.mjs\`). Valores em reais, arredondados.
`;
writeFileSync(out, md);
console.log(`Gravado: ${out}`);
console.log(`Potencial: ${brl(total.revenue)} | 5/10/20%: ${SCENARIOS.map((s) => brl(total.revenue * s.rate)).join(" / ")}`);
