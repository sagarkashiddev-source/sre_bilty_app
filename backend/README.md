# GST Invoice — Backend API

Node.js + Express + PostgreSQL REST API for the Bilty GST Invoice Studio frontend.

## Stack

- **Express** — REST API
- **PostgreSQL** (`pg`) — data store, integer-paise money columns (no floats)
- **Argon2id** (`argon2`) — password hashing
- **JWT** access tokens (15 min) + rotating **httpOnly refresh cookies** (30 days)
- **Zod** — input validation on every route
- **Helmet**, **express-rate-limit**, **cors** — security middleware

## Local development

```bash
npm install
cp .env.example .env        # then edit DATABASE_URL / JWT_SECRET
npm run migrate              # applies backend/src/db/migrations/*.sql, in order, tracked in schema_migrations
npm run dev                  # http://localhost:4000
```

Requires a running PostgreSQL instance. Quickest local option:

```bash
createdb gst_invoice_dev
# DATABASE_URL=postgresql://postgres:postgres@localhost:5432/gst_invoice_dev
```

## Deploying to Render

1. **Create the database first.** Render dashboard → New → PostgreSQL. Note the
   **Internal Database URL** (starts `postgresql://...`) — use the internal URL for
   the web service (same region, no public internet hop) rather than the external one.
2. **Create the web service.** New → Web Service → connect this repo → set the
   **root directory to `backend`** → build command `npm install` → start command `npm start`.
3. **Environment variables** (Render dashboard → Environment):
   - `DATABASE_URL` = the Internal Database URL from step 1
   - `JWT_SECRET` = a long random value — generate with
     `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
   - `CORS_ORIGIN` = your deployed frontend's exact origin, e.g. `https://your-frontend.onrender.com`
     (comma-separate multiple origins if needed)
   - `NODE_ENV` = `production`
4. **Run migrations once** after the first deploy: Render dashboard → Shell (on the
   web service) → `npm run migrate`. Re-run this after every deploy that adds a new
   file to `src/db/migrations/` — already-applied migrations are skipped automatically.
5. **Health check path**: `/api/health` (returns `{"ok":true}`).

### Database backups on Render

Render's managed PostgreSQL takes automatic daily backups (retention depends on
your plan) — Dashboard → your Postgres instance → Backups. You can also trigger a
manual backup or restore to a new instance from that same screen. For an
additional off-Render copy, schedule:

```bash
pg_dump "$DATABASE_URL" -F c -f backup-$(date +%F).dump
```

and store it wherever you keep other backups (S3, Google Drive, etc.). To restore:

```bash
pg_restore -d "$DATABASE_URL" --clean --if-exists backup-2026-08-20.dump
```

### Migrating to a different Postgres provider

The schema has no Render-specific features. To move providers: `pg_dump` from the
old `DATABASE_URL`, `pg_restore` (or run `npm run migrate` on an empty database and
`pg_dump --data-only` the rows) into the new one, then update `DATABASE_URL`.

## API surface

```
POST   /api/auth/register          { email, password }
POST   /api/auth/login             { email, password }
POST   /api/auth/refresh           (reads httpOnly refresh cookie, rotates it)
POST   /api/auth/logout
GET    /api/auth/me

GET    /api/companies
POST   /api/companies
PUT    /api/companies/:id
DELETE /api/companies/:id

GET    /api/customers?companyId=
POST   /api/customers
PUT    /api/customers/:id
DELETE /api/customers/:id

GET    /api/products?companyId=
POST   /api/products
PUT    /api/products/:id
DELETE /api/products/:id

GET    /api/invoices?companyId=&status=&search=   (includes line items)
GET    /api/invoices/:id
POST   /api/invoices               { ..., finalize: false }  -> draft, server assigns invoice number
PUT    /api/invoices/:id           (only while not finalized)
POST   /api/invoices/:id/status    { status }  -> sent/partial/paid transitions
POST   /api/invoices/:id/cancel    (finalized invoices only)
POST   /api/invoices/:id/duplicate -> "Duplicate & Correct": new draft, new number, original preserved
DELETE /api/invoices/:id           (hard-delete drafts, soft-delete finalized)

GET/POST /api/payments, /api/credit-notes, /api/debit-notes
GET/POST/DELETE /api/templates     (recurring invoice templates)
GET      /api/audit-logs?companyId=
```

Every route except `/api/auth/*` and `/api/health` requires
`Authorization: Bearer <accessToken>`, and every company-scoped route re-verifies
that the company (and everything under it) belongs to the authenticated user —
requesting another user's `customerId`/`invoiceId`/etc. by ID returns `404`, not
their data.

## Security notes

- Passwords hashed with Argon2id, never logged or returned by any endpoint.
- All SQL uses parameterized queries (`pg` placeholders) — no string-built SQL.
- All invoice totals (subtotal, CGST/SGST/IGST, round-off, grand total) are
  **recomputed server-side** from company/customer/line-item state on every
  create/update; the browser's submitted totals are never trusted or stored.
- Quantities/rates/amounts are validated non-negative (quantity strictly positive)
  and capped, rejecting negative-price/negative-quantity manipulation attempts.
- Auth endpoints are rate-limited (20 requests / 15 min / IP); all endpoints have a
  global rate limit (300 requests / min / IP) as defense-in-depth.
- Refresh tokens are opaque random values; only their SHA-256 hash is stored, and
  each refresh **rotates** the token (old one is revoked).
