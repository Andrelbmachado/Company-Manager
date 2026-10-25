// Pacotes de site (BÁSICO, ESSENCIAL, PREMIUM; AGENTS.md §9): comparativo de funções, resumo e preço dos cards e a
// tabela de preços por segmento (package_prices). Tudo sai dos dados de service_packages / package_prices: nenhum
// preço ou função fica escrito aqui. SQL nos padrões do banco demo (sem JOIN, IN nem OR; agrupamento em TypeScript).
import { v4 as uuidv4 } from "uuid";
import type { DatabaseLike } from "@/lib/db/demo";
import { roundMoney } from "@/lib/money";
import { can } from "@/lib/permissions/rbac";
import { formatMoney } from "@/lib/prospecting/contact";
import { formatCurrency } from "@/lib/utils";
import type { PackagePrice, Role, ServicePackage } from "@/types";

export const PACKAGE_CODES = ["basico", "essencial", "premium"] as const;
export type PackageCode = (typeof PACKAGE_CODES)[number];

/** Pacotes com o gerenciador (painel de gestão): só eles recebem o escopo do segmento (`feature_note`). */
export const MANAGER_PACKAGE_CODES: readonly string[] = ["essencial", "premium"];

/** Quantas funções o card mostra; a lista completa fica no comparativo. */
export const CARD_FEATURE_LIMIT = 5;

export const packagePricesQueryKey = (companyId: string) => ["package-prices", companyId] as const;

/** Pacote como vem do seed (`features`) ou do banco (`features_json`). */
export type PackageFeatureSource = { code: string; name: string } & ({ features: readonly string[] } | { features_json: string | null });

export type PackageFeatureRow = { feature: string } & Record<PackageCode, boolean>;

export function parsePackageFeatures(json: string | null | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(json ?? "[]");
    return Array.isArray(parsed) ? parsed.map(String).map((item) => item.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

const featuresOf = (pkg: PackageFeatureSource): string[] =>
  "features" in pkg ? pkg.features.map((item) => item.trim()).filter(Boolean) : parsePackageFeatures(pkg.features_json);

const normalize = (text: string) => text.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ");

/** "Tudo do Básico (vitrine pública)" → "básico". */
const INCLUDES = /^tudo d[oa]s? (.+?)(?:\s*\(.*\))?$/i;

/**
 * Comparativo: uma linha por função, uma coluna por pacote (✓/✕). "Tudo do <pacote>" não vira linha: o pacote que a
 * tem ganha todas as funções do pacote citado (inclusive o que ele herda). Ordem: funções do Básico, do Essencial e
 * do Premium. Pacote fora dos três não entra.
 */
export function packageFeatures(packages: readonly PackageFeatureSource[]): PackageFeatureRow[] {
  const known = packages.filter((pkg): pkg is PackageFeatureSource & { code: PackageCode } => (PACKAGE_CODES as readonly string[]).includes(pkg.code));
  const ordered = PACKAGE_CODES.map((code) => known.find((pkg) => pkg.code === code)).filter((pkg): pkg is PackageFeatureSource & { code: PackageCode } => pkg !== undefined);
  const byName = new Map<string, PackageCode>();
  for (const pkg of ordered) {
    byName.set(normalize(pkg.name), pkg.code);
    byName.set(normalize(pkg.code), pkg.code);
  }

  const own = new Map<PackageCode, string[]>();
  const includes = new Map<PackageCode, PackageCode[]>();
  for (const pkg of ordered) {
    const features: string[] = [];
    const included: PackageCode[] = [];
    for (const feature of featuresOf(pkg)) {
      const target = INCLUDES.exec(feature)?.[1];
      const code = target ? byName.get(normalize(target)) : undefined;
      if (code && code !== pkg.code) included.push(code);
      else features.push(feature);
    }
    own.set(pkg.code, features);
    includes.set(pkg.code, included);
  }

  const reach = (code: PackageCode, seen = new Set<PackageCode>()): Set<PackageCode> => {
    seen.add(code);
    for (const next of includes.get(code) ?? []) if (!seen.has(next)) reach(next, seen);
    return seen;
  };
  const covered = new Map(ordered.map((pkg) => [pkg.code, reach(pkg.code)]));

  const rows = new Map<string, PackageFeatureRow>();
  for (const pkg of ordered) {
    for (const feature of own.get(pkg.code) ?? []) {
      const key = normalize(feature);
      const row = rows.get(key) ?? { feature, basico: false, essencial: false, premium: false };
      for (const code of PACKAGE_CODES) if (covered.get(code)?.has(pkg.code)) row[code] = true;
      rows.set(key, row);
    }
  }
  return [...rows.values()];
}

/** Resumo do card: a primeira frase da descrição do pacote. */
export function packageSummary(description: string | null | undefined): string {
  const text = description?.trim() ?? "";
  return text.split(/(?<=[.!?])\s+/)[0] ?? "";
}

/** Preço do card: sem centavos quando o valor é inteiro (R$ 149), com os centavos quando tem (R$ 149,90), como na tabela. */
export function formatPackagePrice(value: number): string {
  const amount = roundMoney(value);
  return Number.isInteger(amount) ? formatMoney(amount) : formatCurrency(amount);
}

/** Menor implantação e menor mensalidade do pacote entre os segmentos ("a partir de"); sem preço, null. */
export function startingPrices(prices: readonly PackagePrice[], packageId: string): { setup: number; monthly: number } | null {
  const own = prices.filter((price) => price.package_id === packageId && !price.deleted_at);
  if (own.length === 0) return null;
  return { setup: Math.min(...own.map((price) => price.setup_price)), monthly: Math.min(...own.map((price) => price.monthly_price)) };
}

export type SegmentPriceField = "setup" | "monthly";

/** Coluna da tabela por segmento: `basico_setup`, `premium_monthly`... */
export const segmentPriceKey = (code: string, field: SegmentPriceField) => `${code}_${field}`;

/** Linha da tabela de preços por segmento. `id` = nome atual do segmento. */
export type SegmentPriceRow = { id: string; segment: string; leads: number; feature_note: string | null } & Record<string, string | number | null>;

type PackageRef = Pick<ServicePackage, "id" | "code" | "name">;
type LeadSegment = { pricing_segment?: string | null; category?: string | null };

/** Segmento de preço do lead (o mesmo critério da contagem de leads da tabela). */
const leadSegment = (lead: LeadSegment) => lead.pricing_segment ?? lead.category ?? null;

/** Preços por segmento: uma linha por segmento, com implantação e mensalidade de cada pacote e quantos leads usam o segmento. */
export function segmentPriceRows(packages: readonly PackageRef[], prices: readonly PackagePrice[], leads: readonly LeadSegment[]): SegmentPriceRow[] {
  const active = prices.filter((price) => !price.deleted_at);
  const segments = [...new Set(active.map((price) => price.segment))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const counts = new Map<string, number>();
  for (const lead of leads) {
    const segment = leadSegment(lead);
    if (segment) counts.set(segment, (counts.get(segment) ?? 0) + 1);
  }
  return segments.map((segment) => {
    const row: SegmentPriceRow = { id: segment, segment, leads: counts.get(segment) ?? 0, feature_note: null };
    for (const pkg of packages) {
      const price = active.find((item) => item.package_id === pkg.id && item.segment === segment);
      row[segmentPriceKey(pkg.code, "setup")] = price?.setup_price ?? null;
      row[segmentPriceKey(pkg.code, "monthly")] = price?.monthly_price ?? null;
    }
    row.feature_note = packages.map((pkg) => active.find((item) => item.package_id === pkg.id && item.segment === segment)?.feature_note).find(Boolean) ?? null;
    return row;
  });
}

export interface SegmentPriceChanges {
  /** Linhas alteradas: `id` = nome do segmento antes da alteração, mais só os campos que mudaram. */
  updated: ({ id: string } & Record<string, unknown>)[];
  created: Record<string, unknown>[];
}

const FIELD_LABEL: Record<SegmentPriceField, string> = { setup: "implantação", monthly: "mensalidade" };

function priceValue(value: unknown, pkg: PackageRef, field: SegmentPriceField, segment: string): number {
  if (value === null || value === undefined || value === "") throw new Error(`Informe a ${FIELD_LABEL[field]} do ${pkg.name} em ${segment}.`);
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Valor inválido na ${FIELD_LABEL[field]} do ${pkg.name} em ${segment}.`);
  if (value < 0) throw new Error(`A ${FIELD_LABEL[field]} do ${pkg.name} em ${segment} não pode ser negativa.`);
  return roundMoney(value);
}

const noteValue = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/**
 * Grava a tabela de preços por segmento. Editar exige `edit` em `leads` e Adicionar exige `create` (a camada de dados
 * barra, não só a tela). Valida tudo antes de escrever: com qualquer erro, nada é gravado. Segmento usado por lead não
 * troca de nome (leads.pricing_segment guarda o nome; trocar deixaria o lead sem preço).
 */
export async function saveSegmentPrices(
  db: DatabaseLike,
  companyId: string,
  actor: { role: Role },
  changes: SegmentPriceChanges,
): Promise<{ inserted: number; updated: number }> {
  if (changes.updated.length > 0 && !can(actor.role, "edit", "leads")) throw new Error("Seu perfil não tem permissão para editar os preços dos pacotes.");
  if (changes.created.length > 0 && !can(actor.role, "create", "leads")) throw new Error("Seu perfil não tem permissão para adicionar segmentos de preço.");

  const packages = await db.select<ServicePackage[]>("SELECT * FROM service_packages WHERE company_id=? AND deleted_at IS NULL ORDER BY sort_order ASC", [companyId]);
  const all = await db.select<PackagePrice[]>("SELECT * FROM package_prices WHERE company_id=?", [companyId]);
  const active = all.filter((price) => !price.deleted_at);
  const segments = new Set(active.map((price) => price.segment));
  const taken = new Map([...segments].map((segment) => [normalize(segment), segment]));
  const now = new Date().toISOString();

  type Write = { kind: "update"; price: PackagePrice; values: Pick<PackagePrice, "segment" | "setup_price" | "monthly_price" | "feature_note"> } | { kind: "insert"; row: Omit<PackagePrice, "id" | "created_at" | "updated_at" | "deleted_at"> };
  const writes: Write[] = [];

  const claim = (name: string) => {
    const existing = taken.get(normalize(name));
    if (existing !== undefined) throw new Error(`Já existe o segmento "${existing}".`);
    taken.set(normalize(name), name);
  };
  const segmentName = (value: unknown) => {
    const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
    if (!name) throw new Error("Informe o nome do segmento.");
    return name;
  };
  /** Preço novo de (pacote, segmento): reaproveita a linha excluída, se houver (UNIQUE package_id + segment). */
  const addPrice = (pkg: PackageRef, segment: string, setup: number, monthly: number, note: string | null) => {
    const deleted = all.find((price) => price.deleted_at && price.package_id === pkg.id && price.segment === segment);
    const feature_note = MANAGER_PACKAGE_CODES.includes(pkg.code) ? note : null;
    if (deleted) writes.push({ kind: "update", price: deleted, values: { segment, setup_price: setup, monthly_price: monthly, feature_note } });
    else writes.push({ kind: "insert", row: { company_id: companyId, package_id: pkg.id, segment, setup_price: setup, monthly_price: monthly, feature_note, is_estimate: 0 } });
  };

  let leadSegments: Set<string> | null = null;
  for (const change of changes.updated) {
    const current = change.id;
    if (!segments.has(current)) throw new Error(`O segmento "${current}" não está mais na tabela. Clique em Atualizar.`);
    let segment = current;
    if ("segment" in change) {
      const name = segmentName(change.segment);
      if (name !== current) {
        leadSegments ??= new Set(
          (await db.select<LeadSegment[]>("SELECT * FROM leads WHERE company_id=? AND deleted_at IS NULL", [companyId])).map(leadSegment).filter((item): item is string => !!item),
        );
        if (leadSegments.has(current)) throw new Error(`O segmento "${current}" é usado por lead e não pode trocar de nome.`);
        taken.delete(normalize(current));
        claim(name);
        if (all.some((price) => price.deleted_at && price.segment === name)) throw new Error(`Já existe o segmento "${name}" (excluído).`);
        segment = name;
      }
    }
    const note = "feature_note" in change ? noteValue(change.feature_note) : undefined;
    for (const pkg of packages) {
      const price = active.find((item) => item.package_id === pkg.id && item.segment === current);
      const setupKey = segmentPriceKey(pkg.code, "setup");
      const monthlyKey = segmentPriceKey(pkg.code, "monthly");
      const hasSetup = setupKey in change;
      const hasMonthly = monthlyKey in change;
      if (price) {
        const values = {
          segment,
          setup_price: hasSetup ? priceValue(change[setupKey], pkg, "setup", current) : price.setup_price,
          monthly_price: hasMonthly ? priceValue(change[monthlyKey], pkg, "monthly", current) : price.monthly_price,
          feature_note: note !== undefined && MANAGER_PACKAGE_CODES.includes(pkg.code) ? note : (price.feature_note ?? null),
        };
        const changed = values.segment !== price.segment || values.setup_price !== price.setup_price || values.monthly_price !== price.monthly_price || values.feature_note !== (price.feature_note ?? null);
        if (changed) writes.push({ kind: "update", price, values });
      } else if (hasSetup || hasMonthly) {
        if (!hasSetup || !hasMonthly) throw new Error(`Informe a implantação e a mensalidade do ${pkg.name} em ${current}.`);
        const fallbackNote = note !== undefined ? note : (active.find((item) => item.segment === current && item.feature_note)?.feature_note ?? null);
        addPrice(pkg, segment, priceValue(change[setupKey], pkg, "setup", current), priceValue(change[monthlyKey], pkg, "monthly", current), fallbackNote);
      }
    }
  }

  for (const change of changes.created) {
    const segment = segmentName(change.segment);
    claim(segment);
    const note = noteValue(change.feature_note);
    for (const pkg of packages) {
      const setup = priceValue(change[segmentPriceKey(pkg.code, "setup")], pkg, "setup", segment);
      const monthly = priceValue(change[segmentPriceKey(pkg.code, "monthly")], pkg, "monthly", segment);
      addPrice(pkg, segment, setup, monthly, note);
    }
  }

  let inserted = 0;
  let updated = 0;
  for (const write of writes) {
    if (write.kind === "update") {
      const { segment, setup_price, monthly_price, feature_note } = write.values;
      await db.execute("UPDATE package_prices SET segment=?, setup_price=?, monthly_price=?, feature_note=?, deleted_at=NULL, updated_at=? WHERE id=?", [
        segment,
        setup_price,
        monthly_price,
        feature_note,
        now,
        write.price.id,
      ]);
      if (write.price.deleted_at) inserted += 1;
      else updated += 1;
    } else {
      const { row } = write;
      await db.execute(
        "INSERT INTO package_prices (id, company_id, package_id, segment, setup_price, monthly_price, feature_note, is_estimate, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [uuidv4(), row.company_id, row.package_id, row.segment, row.setup_price, row.monthly_price, row.feature_note, row.is_estimate, now, now],
      );
      inserted += 1;
    }
  }
  return { inserted, updated };
}
