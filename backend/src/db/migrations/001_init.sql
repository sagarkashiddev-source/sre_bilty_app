-- GST Invoice App — initial schema
-- All money columns are stored as integer PAISE (never floating point) to
-- match the frontend's paise-based arithmetic and avoid rounding drift.

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         CITEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);

CREATE TABLE companies (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  gstin        TEXT,
  address      TEXT,
  phone        TEXT,
  email        TEXT,
  state        TEXT,
  state_code   TEXT,
  logo_style   TEXT DEFAULT 'custom',
  logo_color   TEXT DEFAULT '#C6332B',
  logo_url     TEXT,
  bank_details JSONB DEFAULT '{}'::jsonb,
  terms        TEXT,
  invoice_seq  INTEGER NOT NULL DEFAULT 0, -- last used invoice number per company
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_companies_user ON companies(user_id);

CREATE TABLE customers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  gstin            TEXT,
  billing_address  TEXT,
  shipping_address TEXT,
  phone            TEXT,
  email            TEXT,
  state            TEXT,
  state_code       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_customers_company ON customers(company_id);

CREATE TABLE products (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  hsn_sac      TEXT,
  unit         TEXT DEFAULT 'Nos',
  rate_paise   BIGINT NOT NULL DEFAULT 0,
  gst_rate     NUMERIC(5,2) NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_products_company ON products(company_id);

-- draft -> finalized(sent) -> partial/paid ; cancelled is terminal from any non-draft state
CREATE TYPE invoice_status AS ENUM ('draft', 'sent', 'partial', 'paid', 'cancelled');

CREATE TABLE invoices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id       UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_snapshot JSONB, -- name/gstin/address frozen at finalize time
  invoice_number    TEXT NOT NULL,
  invoice_date      DATE NOT NULL,
  due_date          DATE,
  status            invoice_status NOT NULL DEFAULT 'draft',
  finalized         BOOLEAN NOT NULL DEFAULT false,
  subtotal_paise      BIGINT NOT NULL DEFAULT 0,
  discount_paise       BIGINT NOT NULL DEFAULT 0,
  taxable_amount_paise BIGINT NOT NULL DEFAULT 0,
  cgst_paise           BIGINT NOT NULL DEFAULT 0,
  sgst_paise           BIGINT NOT NULL DEFAULT 0,
  igst_paise           BIGINT NOT NULL DEFAULT 0,
  round_off_paise      BIGINT NOT NULL DEFAULT 0,
  grand_total_paise    BIGINT NOT NULL DEFAULT 0,
  notes             TEXT,
  terms             TEXT,
  duplicated_from   UUID REFERENCES invoices(id) ON DELETE SET NULL, -- "corrected" lineage
  deleted_at        TIMESTAMPTZ, -- soft delete for finalized invoices
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- invoice number is unique per company only among non-deleted rows (partial index below)
  CONSTRAINT chk_finalized_status CHECK (NOT (finalized = false AND status <> 'draft'))
);
CREATE INDEX idx_invoices_company ON invoices(company_id);
CREATE INDEX idx_invoices_customer ON invoices(customer_id);
CREATE UNIQUE INDEX uq_invoice_number_per_company
  ON invoices(company_id, invoice_number) WHERE deleted_at IS NULL;

CREATE TABLE invoice_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id          UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id          UUID REFERENCES products(id) ON DELETE SET NULL,
  product_name_snapshot TEXT NOT NULL,
  hsn_sac             TEXT,
  quantity            NUMERIC(14,3) NOT NULL DEFAULT 1,
  unit                TEXT DEFAULT 'Nos',
  rate_paise          BIGINT NOT NULL DEFAULT 0,
  discount_paise      BIGINT NOT NULL DEFAULT 0,
  gst_rate            NUMERIC(5,2) NOT NULL DEFAULT 0,
  taxable_amount_paise BIGINT NOT NULL DEFAULT 0,
  cgst_paise          BIGINT NOT NULL DEFAULT 0,
  sgst_paise          BIGINT NOT NULL DEFAULT 0,
  igst_paise          BIGINT NOT NULL DEFAULT 0,
  total_paise         BIGINT NOT NULL DEFAULT 0,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_invoice_items_invoice ON invoice_items(invoice_id);

CREATE TABLE payments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id    UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount_paise  BIGINT NOT NULL,
  method        TEXT,
  reference     TEXT,
  paid_on       DATE NOT NULL DEFAULT CURRENT_DATE,
  status        TEXT NOT NULL DEFAULT 'recorded', -- recorded | void
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payments_invoice ON payments(invoice_id);
CREATE INDEX idx_payments_company ON payments(company_id);

CREATE TABLE credit_notes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id    UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  note_number   TEXT NOT NULL,
  amount_paise  BIGINT NOT NULL,
  reason        TEXT,
  status        TEXT NOT NULL DEFAULT 'issued', -- issued | void
  issued_on     DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_credit_notes_invoice ON credit_notes(invoice_id);

CREATE TABLE debit_notes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id    UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  note_number   TEXT NOT NULL,
  amount_paise  BIGINT NOT NULL,
  reason        TEXT,
  status        TEXT NOT NULL DEFAULT 'issued',
  issued_on     DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_debit_notes_invoice ON debit_notes(invoice_id);

CREATE TABLE recurring_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id   UUID REFERENCES customers(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  cadence       TEXT NOT NULL DEFAULT 'monthly',
  next_run_on   DATE,
  payload       JSONB NOT NULL, -- serialized item list + defaults, reused by frontend generator
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_templates_company ON recurring_templates(company_id);

CREATE TABLE audit_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID REFERENCES companies(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT,
  action       TEXT NOT NULL,
  old_value    JSONB,
  new_value    JSONB,
  reason       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_company ON audit_logs(company_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at);

-- keep updated_at fresh automatically
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_companies_updated BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_invoices_updated BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_templates_updated BEFORE UPDATE ON recurring_templates FOR EACH ROW EXECUTE FUNCTION set_updated_at();
