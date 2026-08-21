# Bilty GST Invoice — Mobile App

React Native (Expo) app for Android/iOS, sharing the same backend and login as
the web app — invoices created on the web show up instantly on the phone and
vice versa. Full feature parity: companies, customers, products, invoice
create/edit with live GST calculation, history with Cancel / Duplicate &
Correct / Remove, payments, and PDF generation + native share/print.

## How it stays in sync with the web app

Both clients talk to the exact same backend (`/backend` in the repo root) and
the exact same PostgreSQL database. There is no separate mobile database and
no offline-first sync engine — the phone just calls the same REST API the
browser does. The only backend difference is how the two clients handle
tokens: the web app relies on an httpOnly cookie (can't be read by page
JavaScript, safest in a browser); the phone app has no shared cookie jar, so
it stores its refresh token in the OS's encrypted keystore
(`expo-secure-store` — Android Keystore / iOS Keychain) and sends it
explicitly. The backend's `/api/auth/refresh` and `/api/auth/logout` accept
either method — same server, same login, both platforms.

## Run locally

```bash
cd mobile
npm install
cp .env.example .env
```

Edit `.env` — if testing on a **physical phone** or most emulators,
`localhost` won't reach your dev machine. Use your computer's LAN IP instead:

```
EXPO_PUBLIC_API_URL=http://192.168.1.50:4000
```

(Find your LAN IP with `ipconfig` on Windows or `ifconfig`/`ip a` on
Mac/Linux. Make sure `backend` is running — see the root `README.md` — and
that your phone is on the same Wi-Fi network.)

```bash
npx expo start
```

Scan the QR code with **Expo Go** (from the Play Store / App Store) for the
fastest way to try it on a real device without building anything. Note: this
app uses a couple of native modules (`expo-secure-store`, `expo-print`,
`react-native-webview`) that work fine in Expo Go — no custom dev client
needed for local testing.

## Building for the Play Store

This project could not be built or submitted from within the sandboxed
environment used to write it — producing a signed `.aab` requires either a
local Android SDK/NDK toolchain or a network connection to Expo's EAS Build
cloud service, neither of which was available. The code has been verified to
**bundle successfully** (Metro bundled all ~1,000 modules with no errors), but
the actual build/submit steps below need to be run by you.

### 1. One-time setup

```bash
npm install -g eas-cli
eas login                       # creates/uses your free Expo account
cd mobile
eas init                        # links this project to an EAS project, fills in app.json's extra.eas.projectId
```

### 2. Point the app at your deployed backend

Edit `eas.json` and replace `https://your-backend.onrender.com` in both the
`preview` and `production` build profiles with your actual deployed backend
URL (see the root `README.md` / `backend/README.md` for deploying it to
Render first — the mobile app needs a real, public backend URL; it can't use
`localhost`).

### 3. Build

```bash
# Quick internal APK to test on a real device before submitting:
eas build --platform android --profile preview

# The actual Play Store submission artifact (Android App Bundle):
eas build --platform android --profile production
```

Both run on Expo's build servers — you'll get a link to download the
resulting file when it's done (10–20 minutes typically). EAS also handles
generating and storing your Android signing key for you (recommended), or
you can provide your own.

### 4. Google Play Console — one-time setup

1. Go to https://play.google.com/console, pay the one-time $25 registration
   fee, and complete identity verification (this can take a day or two —
   start this in parallel with building the app).
2. Create a new app: **Create app** → name "Bilty GST Invoice" → default
   language → Free → confirm declarations.
3. **Privacy policy (required)** — this app handles personal and financial
   data (GSTINs, invoice amounts, customer contact info), so Play Console
   will require a privacy policy URL before you can publish. If you don't
   have one, the fastest path is a simple static page (e.g. hosted alongside
   your web app) stating what data is collected (account email, company/
   customer/invoice data you enter), that it's stored securely, not sold,
   and how someone can request deletion. Add the URL under **Policy → App
   content → Privacy policy**.
4. **Data safety form** (Policy → App content → Data safety): declare that
   the app collects account info (email), and financial/business info you
   enter (invoices, customers), that data is encrypted in transit (HTTPS),
   and users can request account/data deletion by contacting you.
5. **Content rating questionnaire**: this is a business/utility app with no
   objectionable content — should land in "Everyone."
6. **App content** → Target audience: not designed for children.

### 5. Submit the build

Once you have a production `.aab` from step 3:

```bash
eas submit --platform android --profile production
```

This uploads it straight to Play Console (you'll need to generate a Google
Play service account key the first time — `eas submit` will walk you through
it and link the official docs). Alternatively, download the `.aab` from the
EAS build page and upload it manually under **Release → Testing → Internal
testing** (recommended first) or **Production** in Play Console.

Start with **Internal testing** — it publishes instantly to testers you add
by email, so you can confirm everything works on a real device before
requesting the full review that a public Production release requires
(review typically takes a few hours to a few days for a new app).

### 6. Store listing assets you'll need

- App icon: 512×512 PNG (replace the placeholder `assets/icon.png` first —
  it's currently Expo's generic template icon, not your brand).
- Feature graphic: 1024×500 PNG.
- At least 2 phone screenshots (portrait, real device or emulator).
- Short description (≤80 chars) and full description (≤4000 chars).

## What's genuinely full-parity with the web app vs. simplified for v1

**Full parity:** auth, companies, customers, products, invoice create/edit
with live server-consistent GST math, invoice history with Cancel /
Duplicate & Correct / Remove, PDF generation matching the same layout as the
web app's print output, payments.

**Simplified for this first version** (all live in the same backend, so
adding them later is additive, not a rewrite): customer ledger / outstanding
balances view, recurring invoice templates, multi-metric reports/analytics,
credit/debit notes UI, and company-performance tracking — these all exist in
the web app but weren't ported to a dedicated mobile screen yet. Let me know
if you'd like any of these added next.
