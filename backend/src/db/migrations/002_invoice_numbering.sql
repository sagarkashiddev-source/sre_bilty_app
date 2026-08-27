-- Proper invoice numbering: one atomic counter per (company, numbering bucket).
-- "bucket" is the financial year string (e.g. '2026/27') when the company has
-- fyResetEnabled, or the constant 'ALL' when numbering runs continuously.
-- Using a dedicated table (rather than the single companies.invoice_seq column)
-- lets each company reset its own sequence every financial year without ever
-- reusing a number, and keeps the increment atomic under concurrent saves.

CREATE TABLE invoice_counters (
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bucket      TEXT NOT NULL, -- financial year e.g. '2026/27', or 'ALL'
  last_seq    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, bucket)
);

-- Carry forward each company's existing continuous sequence so numbers already
-- issued are never repeated after upgrading.
INSERT INTO invoice_counters (company_id, bucket, last_seq)
SELECT id, 'ALL', invoice_seq FROM companies WHERE invoice_seq > 0;
