// Metadados dos documentos de pasta editados direto na tabela (nome e observação) e registro novo só com os dados
// (o arquivo vem depois, por Nova versão). Permissão e pasta visível ao setor conferidas aqui, não só na tela.
// Anexos de registros não se editam por aqui: ficam na ficha do registro, que conhece a permissão dele.
import { v4 as uuidv4 } from "uuid";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { fileTypeLabel } from "@/lib/files/format";
import { documentFolder, filePathFor, listFolderDocuments, listVersions, normalizeFolder, renameDocument, sanitizeFileName } from "@/lib/files/store";
import { can } from "@/lib/permissions/rbac";
import type { DocumentRow, Role } from "@/types";
import { canSeeFolder } from "./access";

export interface DocumentActor {
  role: Role;
  userId: string;
}

export type DocumentMetaFields = Partial<Pick<DocumentRow, "title" | "description">>;

export interface DocumentMetaChanges {
  updated: (DocumentMetaFields & { id: string })[];
  created: DocumentMetaFields[];
}

const titleKey = (title: string) => title.normalize("NFC").toLocaleLowerCase("pt-BR");

function cleanTitle(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error("Informe o nome do documento.");
  return sanitizeFileName(raw);
}

function cleanDescription(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, 2000) : null;
}

async function loadFolderDocument(companyId: string, id: string): Promise<DocumentRow> {
  const db = await getDb();
  const [doc] = await db.select<DocumentRow[]>("SELECT * FROM documents WHERE company_id=? AND id=? AND deleted_at IS NULL", [companyId, id]);
  if (!doc || doc.company_id !== companyId) throw new Error("Documento não encontrado (pode ter sido excluído).");
  if (doc.entity_type) throw new Error("Anexo de registro: altere pela ficha do registro.");
  return doc;
}

async function assertFreeTitle(companyId: string, folder: string, title: string, exceptId?: string): Promise<void> {
  const clash = (await listFolderDocuments(companyId)).find((doc) => doc.id !== exceptId && documentFolder(doc) === folder && titleKey(doc.title) === titleKey(title));
  if (clash) throw new Error(`Já existe "${clash.title}" nesta pasta.`);
}

/**
 * Grava nome/observação alterados e cria registros só com os dados na pasta `folder`. Exige `edit`/`create` em
 * `documents` e que o setor enxergue a pasta. Renomear vale para todas as versões (renameDocument).
 */
export async function saveDocumentMetadata(companyId: string, actor: DocumentActor, folder: string, changes: DocumentMetaChanges): Promise<{ created: DocumentRow[] }> {
  if (changes.created.length && !can(actor.role, "create", "documents")) throw new Error("Seu perfil não tem permissão para adicionar documentos.");
  if (changes.updated.length && !can(actor.role, "edit", "documents")) throw new Error("Seu perfil não tem permissão para editar documentos.");
  const target = normalizeFolder(folder);
  if (changes.created.length && !canSeeFolder(actor.role, target)) throw new Error(target ? `Sua área não tem acesso à pasta /${target}.` : "Abra uma pasta da sua área para adicionar documentos.");

  const db = await getDb();
  const now = new Date().toISOString();

  for (const fields of changes.updated) {
    let doc = await loadFolderDocument(companyId, fields.id);
    if (!canSeeFolder(actor.role, documentFolder(doc))) throw new Error("Sua área não tem acesso a este documento.");
    if ("title" in fields) {
      const title = cleanTitle(fields.title);
      if (title !== doc.title) doc = await renameDocument(doc, title, actor.userId);
    }
    if ("description" in fields) {
      const description = cleanDescription(fields.description);
      for (const version of await listVersions(doc)) {
        await db.execute("UPDATE documents SET description=?, updated_at=? WHERE company_id=? AND id=? AND deleted_at IS NULL", [description, now, companyId, version.id]);
      }
      await emit({ type: "document.updated", companyId, actorId: actor.userId, entityType: "document", entityId: doc.id, title: `Observação alterada: ${doc.title}`, module: "documents" });
    }
  }

  const created: DocumentRow[] = [];
  for (const fields of changes.created) {
    const title = cleanTitle(fields.title);
    await assertFreeTitle(companyId, target, title);
    const row: DocumentRow = {
      id: uuidv4(),
      company_id: companyId,
      title,
      type: fileTypeLabel(title),
      file_path: filePathFor({ entityType: null, entityId: null, folder: target }, title),
      version: 1,
      tags_json: "[]",
      entity_type: null,
      entity_id: null,
      uploaded_by: actor.userId,
      folder: target || null,
      description: cleanDescription(fields.description),
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
    await db.execute(
      "INSERT INTO documents (id, company_id, title, type, file_path, version, tags_json, uploaded_by, folder, description, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [row.id, companyId, row.title, row.type, row.file_path, 1, "[]", actor.userId, row.folder, row.description, now, now],
    );
    await emit({ type: "document.created", companyId, actorId: actor.userId, entityType: "document", entityId: row.id, title: `Documento registrado: ${title}`, module: "documents" });
    created.push(row);
  }
  return { created };
}
