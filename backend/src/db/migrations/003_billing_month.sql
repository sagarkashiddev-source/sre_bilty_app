-- Backs the "Billing Month" field added to the invoice form (lets you pick
-- which month an old/back-dated bill actually covers, independent of the
-- invoice date). It was added client-side only and never persisted, so it
-- silently reset every time a saved invoice was reopened.
ALTER TABLE invoices ADD COLUMN billing_month TEXT;
