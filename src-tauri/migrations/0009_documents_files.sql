-- Documentos com arquivo real: os bytes ficam fora do banco (desktop: $APPDATA/files/<companyId>/<sha256[0..2]>/<sha256>;
-- navegador: IndexedDB) e aqui ficam só os metadados. entity_type/entity_id (anexo de cliente, ticket, OS, fatura...)
-- já existem desde a 0001. file_path continua sendo o caminho lógico mostrado na tela (pasta + nome).
-- Versões: mesmo título na mesma pasta → nova linha com parent_version_id = versão anterior e version = anterior + 1.
-- Dedupe: mesmo sha256 na empresa = mesmo arquivo em disco; os bytes só somem quando nenhuma linha ativa os usa.

ALTER TABLE documents ADD COLUMN storage_key       TEXT;
ALTER TABLE documents ADD COLUMN original_name     TEXT;
ALTER TABLE documents ADD COLUMN mime              TEXT;
ALTER TABLE documents ADD COLUMN size_bytes        INTEGER;
ALTER TABLE documents ADD COLUMN sha256            TEXT;
ALTER TABLE documents ADD COLUMN parent_version_id TEXT REFERENCES documents(id);
ALTER TABLE documents ADD COLUMN folder            TEXT;
ALTER TABLE documents ADD COLUMN description       TEXT;

CREATE INDEX IF NOT EXISTS idx_documents_company ON documents(company_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_documents_sha256 ON documents(company_id, sha256);
CREATE INDEX IF NOT EXISTS idx_documents_parent ON documents(parent_version_id);
