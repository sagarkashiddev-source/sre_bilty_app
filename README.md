# Bilty GST Invoice Studio

A cloud-backed GST invoicing application: React/Vite frontend, Node/Express REST
API, PostgreSQL database. Multi-device, multi-company, with authentication,
server-authoritative GST math, and an audit-friendly invoice lifecycle
(draft → sent → partial/paid, or cancelled — with "Duplicate & Correct" for fixing
a finalized invoice without ever mutating or losing the original).

```
Browser (phone / laptop / tablet)
        │  HTTPS
        ▼
 React frontend (this repo, root)
        │  fetch() — JSON over HTTPS, JWT bearer + httpOnly refresh cookie
        ▼
 Express API (backend/)
        │  parameterized SQL
        ▼
 PostgreSQL (Render / Neon / Supabase / your own)
```

The frontend never sees a database credential — only a short-lived access token.

## Repository layout

```
/                     React/Vite frontend (this app)
/backend              Express API + PostgreSQL migrations (see backend/README.md)
/mobile               React Native (Expo) Android/iOS app — same backend, same login (see mobile/README.md)
```

## Run everything locally

**1. Database** — any local Postgres works:
```bash
createdb gst_invoice_dev
```

**2. Backend**
```bash
cd backend
npm install
cp .env.example .env      # edit DATABASE_URL to point at gst_invoice_dev, set JWT_SECRET
npm run migrate
npm run dev                # http://localhost:4000
```

**3. Frontend** (separate terminal, repo root)
```bash
npm install
cp .env.example .env       # VITE_API_URL=http://localhost:4000
npm run dev                 # http://localhost:5173
```

Open http://localhost:5173, register an account, and go.

## Verify

```bash
npm test          # GST math / invoice-balance unit tests
npm run build      # production build
```

See `backend/README.md` for the API's own checks (migrations, security notes).

## Deploying

### Backend + database → Render
Full step-by-step instructions are in **`backend/README.md`** — create the
Postgres instance first, then the web service (root directory `backend`), set
`DATABASE_URL` / `JWT_SECRET` / `CORS_ORIGIN`, run `npm run migrate` once.

### Frontend → Render (Static Site)
1. Render dashboard → New → Static Site → connect this repo.
2. Root directory: leave blank (repo root). Build command: `npm install && npm run build`.
   Publish directory: `dist`.
3. Environment variable: `VITE_API_URL` = your deployed backend's URL
   (e.g. `https://gst-invoice-backend.onrender.com`).
4. After the frontend has a URL, go back to the backend's `CORS_ORIGIN` env var
   and set it to that exact frontend URL, then redeploy the backend so CORS allows it.

Once both are live, the app works identically from a phone, a laptop, or any
other device — the PC does not need to be running; the database and API are
hosted independently on Render.

## What changed from the local-storage prototype

- **Data storage**: PostgreSQL, not `localStorage`. Every company, customer,
  product, invoice, payment, credit/debit note, and recurring template is
  fetched from and written to the API.
- **Auth**: registration/login with Argon2id-hashed passwords, JWT access
  tokens, rotating httpOnly refresh cookies. Every API route checks that the
  data being touched actually belongs to the logged-in user.
- **Invoice numbering**: assigned atomically by the database per company
  (`INV-0001`, `INV-0002`, ...) — no more client-generated numbers, no
  possibility of duplicates from concurrent tabs/devices.
- **GST totals**: recomputed server-side on every save; the backend never
  trusts a total submitted by the browser.
- **Invoice lifecycle**: Cancel marks an invoice `cancelled` and keeps it in
  history for audit; **Duplicate & Correct** creates a new, freshly-numbered
  draft from a finalized (including cancelled) invoice without ever editing
  the original.
- **Products**: new — a company-scoped catalog you can pick from while
  building an invoice line, auto-filling HSN/SAC, rate, and GST rate.
- **PDF/print**: fixed the root cause of "PDF doesn't match the screen" — the
  print preview was rendered inside a fixed-height, scrollable modal, which
  clips content instead of paginating. Print/PDF now use a proper `@page` A4
  rule, unlock that modal on print, keep table rows and summary blocks from
  splitting across a page break, and repeat the item-table header on every
  page for long, multi-page invoices.
- **Offline resilience**: an offline banner, and the in-progress invoice draft
  is autosaved to the device so it can be recovered if the tab/browser closes
  unexpectedly — the server is still always the source of truth once you're
  back online.

See `TESTING.md` for the full manual test checklist and what's already been verified.
