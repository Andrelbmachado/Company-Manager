#!/usr/bin/env node
// Gera src/lib/prospecting/data/siteProspecting.generated.ts a partir do CSV de leads.
//
// Uso: node scripts/site-prospecting/build-seed.mjs [caminho/do/SEM_SITE_sorocaba_filtrado.csv]
// CSV padrão: ~/LeadingSitesSorocaba/leads/SEM_SITE_sorocaba_filtrado.csv
//
// Sem dependências externas. O arquivo gerado é versionado (o repositório não depende do CSV).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OUTREACH, PACKAGES, PRICES, SCENARIOS, suggestPackage } from "./pricing.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const csvPath = process.argv[2] ?? resolve(homedir(), "LeadingSitesSorocaba/leads/SEM_SITE_sorocaba_filtrado.csv");
const outPath = resolve(here, "../../src/lib/prospecting/data/siteProspecting.generated.ts");

// ── CSV ────────────────────────────────────────────────────────────

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^﻿/, "");
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(field); field = "";
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
    } else field += char;
  }
  if (field !== "" || row.length) { row.push(field); if (row.some((cell) => cell !== "")) rows.push(row); }
  const [header, ...body] = rows;
  return body.map((cells) => Object.fromEntries(header.map((name, index) => [name.trim(), (cells[index] ?? "").trim()])));
}

// ── Normalização ──────────────────────────────────────────────────

/** Extrai todos os telefones de um texto livre. DDD ausente herda o do número anterior (padrão 15). */
function parsePhones(raw) {
  const phones = [];
  let lastDdd = "15";
  for (const match of raw.matchAll(/(?:\(?(\d{2})\)?\s*)?(9?\d{4})-?(\d{4})/g)) {
    const ddd = match[1] ?? lastDdd;
    lastDdd = ddd;
    const prefix = match[2];
    const mobile = prefix.length === 5 && prefix.startsWith("9");
    phones.push({ formatted: `(${ddd}) ${prefix}-${match[3]}`, mobile });
  }
  return phones;
}

function parseRating(raw) {
  const match = raw.match(/^(\d+(?:[.,]\d+)?)\s*★\s*\((\d+)\)$/);
  if (!match) return { rating: null, reviews: null };
  return { rating: Number(match[1].replace(",", ".")), reviews: Number(match[2]) };
}

function presenceKind(raw) {
  if (raw.startsWith("Domínio/site quebrado")) return "site_quebrado";
  if (raw.startsWith("Só redes")) return "redes_agendamento";
  return "nenhuma";
}

function splitObservation(raw) {
  const [notes, source] = raw.split(/\s*\|\s*Fonte:\s*/);
  return { notes: (notes ?? "").trim(), sourceUrl: source?.trim() || null };
}

function isBusinessDay(date) {
  const day = date.getUTCDay();
  return day !== 0 && day !== 6 && !OUTREACH.holidays.includes(date.toISOString().slice(0, 10));
}

/** Datas úteis a partir de startDate (UTC, sem fuso para evitar deslocamento de dia). */
function businessDays(count) {
  const days = [];
  const cursor = new Date(`${OUTREACH.startDate}T00:00:00Z`);
  while (days.length < count) {
    if (isBusinessDay(cursor)) days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

// ── Montagem ──────────────────────────────────────────────────────

const csvRows = parseCsv(readFileSync(csvPath, "utf8"));
const unknownSegments = new Set();

const leads = csvRows.map((row, index) => {
  const segment = row["segmento"];
  const prices = PRICES[segment];
  if (!prices) unknownSegments.add(segment);

  const phones = parsePhones(row["telefone"]);
  const { rating, reviews } = parseRating(row["avaliações Google"]);
  const kind = presenceKind(row["presença online atual"]);
  const { notes, sourceUrl } = splitObservation(row["observação"]);
  const packageCode = suggestPackage(reviews);
  const [setup, monthly] = prices?.[packageCode] ?? [0, 0];
  const whatsapp = phones.find((phone) => phone.mobile)?.formatted ?? null;

  // Telefone original só é guardado nas observações quando difere do que foi interpretado.
  const rawPhone = row["telefone"];
  const cleanSingle = phones.length === 1 && rawPhone.replace(/\D/g, "").length <= 11;
  const noteParts = [notes];
  if (!cleanSingle && rawPhone) noteParts.push(`Telefone original: ${rawPhone}`);

  return {
    seq: index + 1,
    name: row["nome"],
    category: segment,
    business_type: row["o que o negócio faz"] || null,
    phone: phones[0]?.formatted ?? null,
    whatsapp,
    google_rating: rating,
    google_reviews: reviews,
    sem_site: 1,
    online_presence: row["presença online atual"],
    presence_kind: kind,
    address: row["endereço"],
    notes: noteParts.filter(Boolean).join(" | ") || null,
    source_url: sourceUrl,
    package_code: packageCode,
    estimated_setup: setup,
    estimated_monthly: monthly,
    estimated_revenue: setup + monthly * 12, // implantação + 12 mensalidades (1º ano)
    score: (kind === "site_quebrado" ? 50 : 0) + Math.round(Math.min(reviews ?? 0, 300) / 6),
  };
});

if (unknownSegments.size) {
  console.error(`Segmento sem preço em pricing.mjs: ${[...unknownSegments].join(", ")}`);
  process.exit(1);
}

// Prioridade: site quebrado primeiro, depois mais avaliações; sem telefone vai por último.
const ranked = [...leads].sort((a, b) =>
  Number(!a.phone) - Number(!b.phone) ||
  Number(b.presence_kind === "site_quebrado") - Number(a.presence_kind === "site_quebrado") ||
  (b.google_reviews ?? -1) - (a.google_reviews ?? -1) ||
  b.estimated_revenue - a.estimated_revenue ||
  a.name.localeCompare(b.name, "pt-BR"),
);
const totalDays = Math.ceil(ranked.length / OUTREACH.perDay);
const dates = businessDays(totalDays);
ranked.forEach((lead, index) => {
  const day = Math.floor(index / OUTREACH.perDay) + 1;
  lead.priority_rank = index + 1;
  lead.outreach_day = day;
  lead.outreach_date = dates[day - 1];
});

const prices = Object.entries(PRICES).flatMap(([segment, byPackage]) =>
  PACKAGES.map((pkg) => ({ segment, package_code: pkg.code, setup_price: byPackage[pkg.code][0], monthly_price: byPackage[pkg.code][1] })),
);

const header = `// ARQUIVO GERADO por scripts/site-prospecting/build-seed.mjs — NÃO EDITE À MÃO.
// Fonte dos leads: ${csvPath.replace(homedir(), "~")}
// Preços: scripts/site-prospecting/pricing.mjs (ESTIMATIVA — Proposta_Comercial.md não existia).
// Para regenerar: node scripts/site-prospecting/build-seed.mjs
`;

const body = `
export const SITE_SEED_VERSION = "v1";

export const SITE_PROJECT = {
  name: "Desenvolvimento de Site",
  status: "andamento",
  budget: 0,
  // Meio-dia UTC: formatDate() usa new Date(), e "YYYY-MM-DD" puro apareceria um dia antes no Brasil.
  start_date: ${JSON.stringify(`${OUTREACH.startDate}T12:00:00.000Z`)},
  end_date: ${JSON.stringify(`${dates[dates.length - 1]}T12:00:00.000Z`)},
} as const;

export const SITE_OUTREACH = {
  perDay: ${OUTREACH.perDay},
  startDate: ${JSON.stringify(OUTREACH.startDate)},
  totalDays: ${totalDays},
} as const;

export interface SitePackageSeed {
  code: string;
  name: string;
  sort_order: number;
  description: string;
  features: string[];
}

export interface SitePriceSeed {
  segment: string;
  package_code: string;
  setup_price: number;
  monthly_price: number;
}

export interface SiteScenarioSeed {
  code: string;
  label: string;
  conversion_rate: number;
}

export interface SiteLeadSeed {
  seq: number;
  name: string;
  category: string;
  business_type: string | null;
  phone: string | null;
  whatsapp: string | null;
  google_rating: number | null;
  google_reviews: number | null;
  sem_site: 1;
  online_presence: string;
  presence_kind: "site_quebrado" | "redes_agendamento" | "nenhuma";
  address: string;
  notes: string | null;
  source_url: string | null;
  package_code: string;
  estimated_setup: number;
  estimated_monthly: number;
  estimated_revenue: number;
  score: number;
  priority_rank: number;
  outreach_day: number;
  outreach_date: string;
}

export const SITE_PACKAGES: SitePackageSeed[] = ${JSON.stringify(PACKAGES.map((pkg) => ({ code: pkg.code, name: pkg.name, sort_order: pkg.sortOrder, description: pkg.description, features: pkg.features })), null, 2)};

export const SITE_PRICES: SitePriceSeed[] = ${JSON.stringify(prices, null, 2)};

export const SITE_SCENARIOS: SiteScenarioSeed[] = ${JSON.stringify(SCENARIOS.map((s) => ({ code: s.code, label: s.label, conversion_rate: s.rate })), null, 2)};

export const SITE_LEADS: SiteLeadSeed[] = ${JSON.stringify(ranked, null, 2)};
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, header + body);

const broken = ranked.filter((lead) => lead.presence_kind === "site_quebrado").length;
const mobile = ranked.filter((lead) => lead.whatsapp).length;
const potential = ranked.reduce((sum, lead) => sum + lead.estimated_revenue, 0);
console.log(`Leads: ${ranked.length} | site quebrado: ${broken} | com WhatsApp: ${mobile} | sem telefone: ${ranked.filter((l) => !l.phone).length}`);
console.log(`Dias de abordagem: ${totalDays} (${dates[0]} → ${dates[dates.length - 1]}) | potencial 1º ano: R$ ${potential.toLocaleString("pt-BR")}`);
console.log(`Gerado: ${outPath}`);
