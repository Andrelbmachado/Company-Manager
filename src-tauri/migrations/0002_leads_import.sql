-- ============================================================
-- Migration: 0002_leads_import
-- Campos extras usados na importação de leads (CSV) e na
-- conversão de lead em oportunidade.
-- ============================================================

ALTER TABLE leads ADD COLUMN company_name TEXT;
ALTER TABLE leads ADD COLUMN position TEXT;
ALTER TABLE leads ADD COLUMN notes TEXT;

ALTER TABLE opportunities ADD COLUMN notes TEXT;
ALTER TABLE opportunities ADD COLUMN lead_id TEXT REFERENCES leads(id);

CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(company_id, email);
