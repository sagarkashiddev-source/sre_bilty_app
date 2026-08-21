# Testing checklist

Status legend: ✅ verified live against the running backend/frontend in this
session · ⬜ not yet run — do this before considering the deploy final.

## Setup / core workflow

- ✅ Backend boots, connects to Postgres, migrations apply cleanly
- ✅ Frontend builds (`npm run build`) and unit tests pass (`npm test`, 6/6)
- ✅ Register a new account
- ✅ Log in
- ✅ Create a company
- ✅ Create a customer
- ✅ Create a product
- ✅ Create an invoice, save as draft
- ⬜ Refresh the browser — confirm the draft invoice is still there (frontend load path is wired to the API; verified the equivalent API call sequence directly, but do one real browser refresh to be sure)
- ✅ Log out / log in again — confirmed via a fresh login session pulling the same companies/invoices
- ✅ Open from "another device" — simulated with a second, independent login session (separate cookie jar); it saw the identical company and all 5 invoices with correct statuses
- ⬜ Same check from an actual second browser/device once deployed

## Invoice lifecycle

- ✅ Finalize an invoice (locks it, assigns a real invoice number)
- ✅ Cancel a finalized invoice → status shows `cancelled`, stays in history
- ✅ "Duplicate & Correct" a cancelled invoice → new invoice gets a fresh number (`INV-0002` from `INV-0001`), original is untouched and still shows `cancelled`
- ⬜ Remove/delete a draft invoice from the UI (API-level hard-delete verified; do a UI click-through)
- ⬜ Remove a finalized invoice from the UI and confirm it disappears from history (API-level soft-delete verified: `deleted_at` set, excluded from list queries)

## GST math

- ✅ Interstate transaction (Maharashtra company → Delhi customer) computes IGST only, no CGST/SGST — checked exact paise values
- ✅ Frontend and backend use the same integer-paise algorithm (backend is a direct port); frontend's own unit tests (intrastate CGST/SGST split, interstate IGST, fractional quantities) pass
- ⬜ Intrastate transaction through the actual UI (same-state company/customer → CGST+SGST split)
- ⬜ GST-inclusive vs exclusive pricing toggle, if used, through the UI

## Security

- ✅ User B cannot fetch User A's invoice by ID (`GET /api/invoices/:id` → 404, not the data)
- ✅ User B cannot list User A's customers by guessing `companyId` (→ 404)
- ✅ No token at all → 401
- ✅ Garbage/malformed JWT → 401
- ✅ SQL-injection payload in a search parameter → parameterized query, no effect, table intact
- ✅ Negative quantity / negative rate on an invoice line → rejected (400) — **this was a real gap I found and fixed** during testing; the initial version silently accepted negative × negative as a valid positive total
- ✅ Same negative-value fix applied to products and payments/credit/debit-note amounts
- ✅ Extremely large line-item value (`99999999999`) → rejected (over the 1,000,000,000 cap)
- ✅ XSS payload (`<script>...`) as a customer name → stored as plain text (React escapes on render; sanitizing at the DB layer would corrupt legitimate data, so this is correct behavior, not a gap)
- ✅ Rapid concurrent invoice creation (double-submit) → two distinct sequential numbers, no collision, no duplicate
- ⬜ Expired session cookie in the browser → should redirect to login (refresh-rotation logic verified at the API level; do a real idle-timeout browser check)
- ⬜ CORS from an origin *not* in `CORS_ORIGIN` → should be rejected (verified the allow-list logic reads correctly; didn't test a live disallowed-origin browser request)

## PDF / print

- ✅ Root cause of "PDF doesn't match screen" identified and fixed: the preview
  modal had `max-height` + `overflow:auto`, which clips content on print instead
  of paginating it. Fixed with a proper `@page { size: A4 }` rule, unlocking the
  modal during print, `break-inside: avoid` on rows/sections, and a repeating
  table header for multi-page invoices.
- ⬜ Visual check: 1 item, print/PDF matches the on-screen preview exactly
- ⬜ Visual check: 50+ items, spans multiple A4 pages, no split rows, totals block intact on the last page
- ⬜ Visual check: very long customer address / long company name doesn't overlap or clip
- ⬜ Visual check: CGST+SGST invoice and IGST invoice both render their tax tables correctly
- ⬜ Mobile-generated invoice PDF looks correct

## Cross-device / offline

- ✅ Cross-device data sync (see above)
- ⬜ Real offline test: disconnect network in the browser, confirm the offline banner appears, edits queue locally, reconnect and confirm sync
- ⬜ Force-close the browser tab mid-edit, reopen, confirm the "recover unsaved draft" prompt appears

## Mobile app

- ✅ Metro bundler compiles the full app (1024 modules, no errors) — checked twice, including after an environment reset
- ✅ Mobile-style auth flow (register/login/refresh via request body, no cookies) tested live against the real backend — same account, same data as the web app test above
- ✅ Backend's `/api/auth/refresh` and `/api/auth/logout` confirmed to accept a body-supplied `refreshToken` (mobile) in addition to the httpOnly cookie (web) — same server serves both
- ⬜ Actually running on a device/emulator — I could not do this in this sandbox (no Android SDK, no emulator, no network access to Expo Go/EAS). Run `npx expo start` from `/mobile` and scan the QR code with Expo Go to test on a real phone.
- ⬜ EAS Build (`eas build --platform android --profile preview`) — requires your own Expo account; see `mobile/README.md`.
- ⬜ Play Store submission walkthrough — see `mobile/README.md` for the full checklist (privacy policy, data safety form, content rating, screenshots).

## How to run the ⬜ items yourself

```bash
# terminal 1
cd backend && npm run dev
# terminal 2
npm run dev
# terminal 3 (mobile)
cd mobile && npx expo start
```
Open http://localhost:5173 in a real browser and work through the unchecked
items above. For the "second device" checks, use a different browser (or an
incognito window) logged into the same account. For the mobile app, scan the
Expo QR code with a phone on the same Wi-Fi network as your dev machine (set
`EXPO_PUBLIC_API_URL` in `mobile/.env` to your machine's LAN IP, not
`localhost`).
