// Automation API for AI agents, scripts and E2E tests.
// Available in the browser console / webview as `window.companyManager`.
// Every call runs as the logged-in user and respects RBAC. See AGENTS.md.

import type { QueryClient } from "@tanstack/react-query";
import { getSession } from "@/lib/auth/session";
import { can, type Action } from "@/lib/permissions/rbac";
import { ENTITIES, getEntity, isEntityKey, writableFields, type EntityKey } from "@/lib/data/entities";
import { insertEntities, listEntity, updateEntity, type Row } from "@/lib/data/repository";
import { exportRows, importText, templateCsv, type ExportFormat, type ImportReport } from "@/lib/data/importExport";
import { coerceField } from "@/lib/data/values";
import { browserReset } from "@/lib/data/browserStore";
import { isTauri } from "@/lib/runtime";
import type { Role, Session } from "@/types";

type Navigate = (path: string) => void;

let navigator: Navigate | null = null;
let queryClient: QueryClient | null = null;

export function setAgentNavigator(fn: Navigate | null): void {
  navigator = fn;
}

function requireSession(): Session {
  const s = getSession();
  if (!s) throw new Error("Não autenticado: faça login na tela inicial primeiro.");
  return s;
}

function requireEntity(key: string): EntityKey {
  if (!isEntityKey(key)) throw new Error(`Entidade desconhecida "${key}". Use companyManager.entities().`);
  return key;
}

function authorize(session: Session, action: Action, key: EntityKey): void {
  const def = getEntity(key);
  if (!can(session.membership.role as Role, action, def.resource)) {
    throw new Error(`Sem permissão: ${action} em ${def.resource} para o papel ${session.membership.role}.`);
  }
}

function refresh(): void {
  queryClient?.invalidateQueries();
}

/** Coerce raw values ("1.234,56", "31/12/2026", labels) like the UI form does. */
function coerceRow(key: EntityKey, input: Row): Row {
  const out: Row = {};
  for (const f of writableFields(getEntity(key))) {
    if (!(f.key in input)) continue;
    const v = input[f.key];
    if (f.type === "ref") {
      out[f.key] = v;
      continue;
    }
    const res = coerceField(f, v as string | number | null);
    if (res.error) throw new Error(res.error);
    out[f.key] = res.value;
  }
  return out;
}

const api = {
  version: "1",

  /** Runtime info: "tauri" (SQLite) or "browser" (localStorage demo store). */
  runtime: () => (isTauri() ? "tauri" : "browser"),

  session: () => getSession(),

  /** Describe every entity: fields, types, enum options, required flags. */
  entities: () =>
    Object.values(ENTITIES).map((e) => ({
      key: e.key,
      label: e.labelPlural,
      path: e.path,
      importable: e.importable !== false,
      dedupeBy: e.dedupeBy ?? [],
      fields: e.fields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        required: !!f.required,
        readonly: !!f.readonly,
        options: f.options?.map((o) => o.value),
        ref: f.ref?.entity,
      })),
    })),

  async list(entity: string): Promise<Row[]> {
    const key = requireEntity(entity);
    const session = requireSession();
    authorize(session, "view", key);
    return listEntity(key, session.company.id);
  },

  async create(entity: string, data: Row | Row[]): Promise<Row[]> {
    const key = requireEntity(entity);
    const session = requireSession();
    authorize(session, "create", key);
    const rows = (Array.isArray(data) ? data : [data]).map((r) => coerceRow(key, r));
    const created = await insertEntities(key, session, rows);
    refresh();
    return created;
  },

  async update(entity: string, id: string, patch: Row): Promise<void> {
    const key = requireEntity(entity);
    const session = requireSession();
    authorize(session, "edit", key);
    await updateEntity(key, session, id, coerceRow(key, patch));
    refresh();
  },

  /** Import CSV or JSON text with automatic column mapping. */
  async import(
    entity: string,
    text: string,
    options?: { format?: "csv" | "json"; skipDuplicates?: boolean; mapping?: Record<string, string> }
  ): Promise<ImportReport> {
    const key = requireEntity(entity);
    const session = requireSession();
    authorize(session, "create", key);
    const report = await importText(key, session, text, {
      fileName: options?.format === "json" ? "data.json" : "data.csv",
      skipDuplicates: options?.skipDuplicates,
      mapping: options?.mapping,
    });
    refresh();
    return report;
  },

  async export(entity: string, format: ExportFormat = "csv"): Promise<string> {
    const key = requireEntity(entity);
    const session = requireSession();
    authorize(session, "export", key);
    return exportRows(getEntity(key), await listEntity(key, session.company.id), format);
  },

  template: (entity: string) => templateCsv(getEntity(requireEntity(entity))),

  navigate(path: string): void {
    if (!navigator) throw new Error("Navegação indisponível antes do login.");
    navigator(path);
  },

  /** Browser preview only: restore the demo dataset. */
  resetDemoData(): void {
    if (isTauri()) throw new Error("resetDemoData só existe no preview do navegador.");
    browserReset();
    refresh();
  },
};

export type CompanyManagerApi = typeof api;

declare global {
  interface Window {
    companyManager?: CompanyManagerApi;
  }
}

export function installAgentApi(client?: QueryClient): void {
  if (client) queryClient = client;
  window.companyManager = api;
}
