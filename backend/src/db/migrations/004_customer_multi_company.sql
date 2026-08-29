-- A customer can legitimately be billed by more than one of your companies
-- (e.g. the same freight client billed by both Sagar Roadways and S S K
-- Roadlines). The previous model tied each customer to exactly one company
-- via customers.company_id, which meant the same client had to be re-entered
-- as a completely separate record for each company.
--
-- customers.company_id is kept as the customer's "primary" company (used for
-- historical records, display, and as the default when adding a company),
-- but which companies can actually select this customer when billing is now
-- governed by this join table instead.
CREATE TABLE customer_companies (
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  PRIMARY KEY (customer_id, company_id)
);

-- Backfill: every existing customer keeps access from its current company.
INSERT INTO customer_companies (customer_id, company_id)
SELECT id, company_id FROM customers WHERE company_id IS NOT NULL;
