import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import * as api from "./services/api";
import { draftCache } from "./services/offlineCache";

/* ============================== helpers ============================== */

/** Browser-safe identifier.  The server must replace this with a database UUID. */
const uid = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (globalThis.crypto?.getRandomValues) return `${Date.now()}-${globalThis.crypto.getRandomValues(new Uint32Array(2)).join("")}`;
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const fmt = (n) =>
  (isNaN(n) ? 0 : n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n) {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10), r = n % 10;
  return TENS[t] + (r ? " " + ONES[r] : "");
}
function threeDigits(n) {
  const h = Math.floor(n / 100), r = n % 100;
  let s = "";
  if (h) s += ONES[h] + " Hundred" + (r ? " " : "");
  if (r) s += twoDigits(r);
  return s;
}
function numberToWords(num) {
  num = Math.round(num);
  if (num === 0) return "Zero";
  let n = num;
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const rest = n;
  const parts = [];
  if (crore) parts.push(threeDigits(crore) + " Crore");
  if (lakh) parts.push(twoDigits(lakh) + " Lakh");
  if (thousand) parts.push(twoDigits(thousand) + " Thousand");
  if (rest) parts.push(threeDigits(rest));
  return parts.join(" ").trim();
}
function amountInWords(amount) {
  const totalPaise = typeof amount === "number" ? toPaise(amount) : Number(amount || 0);
  const rupees = Math.floor(totalPaise / 100);
  const paise = totalPaise % 100;
  let words = "INR " + numberToWords(rupees) + " Rupees";
  if (paise > 0) words += " and " + numberToWords(paise) + " Paise";
  return words + " Only";
}

const STATE_CODES = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
  "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
  "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur",
  "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
  "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
  "26": "Dadra & Nagar Haveli and Daman & Diu", "27": "Maharashtra", "28": "Andhra Pradesh (old)",
  "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu",
  "34": "Puducherry", "35": "Andaman & Nicobar", "36": "Telangana", "37": "Andhra Pradesh",
  "38": "Ladakh",
};
const stateFromGSTIN = (g) => (g && g.length >= 2 ? STATE_CODES[g.slice(0, 2)] || "" : "");

/* -------- GSTIN validation (format + real GSTN checksum algorithm) -------- */
const GSTIN_CODEPOINTS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GSTIN_FORMAT_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
// PAN 4th char must be a letter representing the holder type (P, C, H, F, A, T, B, L, J, G) - loose-check, not enforced strictly.

function gstinChecksumValid(gstin) {
  // Standard GSTN check-digit algorithm (mod-36), verified against known-good GSTINs.
  const factor = [1, 2];
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const code = GSTIN_CODEPOINTS.indexOf(gstin[i]);
    if (code < 0) return false;
    const p = code * factor[i % 2];
    sum += Math.floor(p / 36) + (p % 36);
  }
  const checkCodePoint = (36 - (sum % 36)) % 36;
  return GSTIN_CODEPOINTS[checkCodePoint] === gstin[14];
}

/**
 * Validates GSTIN format + checksum only. This is NOT a government/GSTN portal
 * verification (that requires an authorized third-party API and is not performed here).
 * Returns { valid, reason, state, stateCode }.
 */
export function validateGSTIN(raw) {
  const g = (raw || "").trim().toUpperCase();
  if (!g) return { valid: false, reason: "", state: "", stateCode: "" };
  if (g.length !== 15) return { valid: false, reason: "GSTIN must contain 15 characters", state: "", stateCode: "" };
  if (!GSTIN_FORMAT_RE.test(g)) return { valid: false, reason: "Invalid GSTIN format", state: "", stateCode: "" };
  const stateCode = g.slice(0, 2);
  const state = STATE_CODES[stateCode];
  if (!state) return { valid: false, reason: "Invalid GSTIN state code", state: "", stateCode };
  if (!gstinChecksumValid(g)) return { valid: false, reason: "Invalid GSTIN (checksum failed)", state, stateCode };
  return { valid: true, reason: "", state, stateCode };
}

/* -------- financial year (India: April-March) -------- */
export function financialYear(dateISO) {
  const d = dateISO ? new Date(dateISO + "T00:00:00") : new Date();
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear(), m = d.getMonth(); // April = index 3
  const startY = m >= 3 ? y : y - 1;
  return `${startY}-${String((startY + 1) % 100).padStart(2, "0")}`;
}

const TAX_RATES = [0, 5, 12, 18, 28];
const HSN_PRESETS = [
  { label: "Labour Bill (998519)", hsn: "998519", desc: "Labour Bill of Month" },
  { label: "Transport Bill (9965)", hsn: "9965", desc: "Transport Bill of Month" },
  { label: "Loading/Unloading (996813)", hsn: "996813", desc: "Loading & Unloading Charges" },
];

const MONTH_NAMES = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];

function prevMonthRange(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  const y = d.getFullYear(), m = d.getMonth();
  const prevM = m === 0 ? 11 : m - 1;
  const prevY = m === 0 ? y - 1 : y;
  const first = new Date(prevY, prevM, 1);
  const last = new Date(prevY, prevM + 1, 0);
  const fmtD = (dt) => `${String(dt.getDate()).padStart(2, "0")} ${MONTH_NAMES[dt.getMonth()]} ${dt.getFullYear()}`;
  return `${fmtD(first)} to ${fmtD(last)}`;
}

function todayISO() { return new Date().toISOString().slice(0, 10); }
function dispDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return `${String(d.getDate()).padStart(2, "0")} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}
function monthLabel(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return `${MONTH_NAMES[d.getMonth()].slice(0,3)} ${d.getFullYear()}`;
}

/* -------- invoice math --------
   All money math happens in integer paise internally to avoid floating-point
   drift (e.g. 0.1 + 0.2 !== 0.3 in JS). Only the final return values are
   converted back to rupee floats, which is safe because nothing further is
   computed from them - they're purely for display via fmt(). */
export function toPaise(x) {
  const text = String(x ?? "").trim();
  if (!/^-?\d+(\.\d{0,2})?$/.test(text)) return 0;
  const [whole, fraction = ""] = text.split(".");
  return Number(BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2)) * (whole.startsWith("-") ? -1n : 1n));
}
function fromPaise(p) { return p / 100; }

/** Converts a decimal UI value to an integer at a known precision, without float math. */
function decimalScaled(value, scale = 3) {
  const text = String(value ?? "0").trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return 0n;
  const negative = text.startsWith("-");
  const [wholeRaw, fraction = ""] = (negative ? text.slice(1) : text).split(".");
  const base = 10n ** BigInt(scale);
  const raw = BigInt(wholeRaw || "0") * base + BigInt((fraction + "0".repeat(scale)).slice(0, scale));
  return negative ? -raw : raw;
}
export function lineAmountPaise(qty, rate) {
  // Quantity supports three decimals; rate is paise. Half-up round to one paise.
  const quantityMilli = decimalScaled(qty, 3);
  const product = quantityMilli * BigInt(toPaise(rate));
  return Number(product >= 0n ? (product + 500n) / 1000n : (product - 500n) / 1000n);
}

export function computeInvoice(inv, company, customerData) {
  const items = (inv.items || []).map((it) => {
    const amountPaise = lineAmountPaise(it.qty, it.rate);
    return { ...it, amountPaise, amount: fromPaise(amountPaise) };
  });
  const taxablePaise = items.reduce((s, i) => s + i.amountPaise, 0);

  const companyState = company?.gstin ? stateFromGSTIN(company.gstin) : (company?.state || "");
  const custState = customerData?.gstin ? stateFromGSTIN(customerData.gstin) : (customerData?.state || "");
  const interstate = companyState && custState ? companyState !== custState : false;

  const hsnMap = {};
  items.forEach((it) => {
    const rate = String(it.taxRate ?? "0");
    const key = (it.hsn || "-") + "|" + rate;
    if (!hsnMap[key]) hsnMap[key] = { hsn: it.hsn || "-", rate, taxablePaise: 0 };
    hsnMap[key].taxablePaise += it.amountPaise;
  });

  let totalTaxPaise = 0;
  const hsnRows = Object.values(hsnMap).map((row) => {
    const taxAmtPaise = Number((BigInt(row.taxablePaise) * decimalScaled(row.rate, 2) + 5000n) / 10000n);
    totalTaxPaise += taxAmtPaise;
    const cgstPaise = Math.floor(taxAmtPaise / 2);
    const sgstPaise = taxAmtPaise - cgstPaise; // absorbs the odd paise so CGST+SGST always == total
    const base = {
      hsn: row.hsn, rate: Number(row.rate),
      taxable: fromPaise(row.taxablePaise),
      total: fromPaise(taxAmtPaise),
    };
    if (interstate) return { ...base, igst: fromPaise(taxAmtPaise), cgst: 0, sgst: 0 };
    return { ...base, igst: 0, cgst: fromPaise(cgstPaise), sgst: fromPaise(sgstPaise) };
  });

  const cgstTotalPaise = interstate ? 0 : hsnRows.reduce((s, r) => s + toPaise(r.cgst), 0);
  const sgstTotalPaise = interstate ? 0 : hsnRows.reduce((s, r) => s + toPaise(r.sgst), 0);
  const igstTotalPaise = interstate ? totalTaxPaise : 0;

  const rawTotalPaise = taxablePaise + totalTaxPaise;
  const grandTotalPaise = Math.round(rawTotalPaise / 100) * 100; // round to nearest whole rupee
  const roundOffPaise = grandTotalPaise - rawTotalPaise;

  return {
    items,
    subtotalPaise: taxablePaise,
    taxablePaise,
    cgstPaise: cgstTotalPaise,
    sgstPaise: sgstTotalPaise,
    igstPaise: igstTotalPaise,
    roundOffPaise,
    grandTotalPaise,
    taxable: fromPaise(taxablePaise),
    totalTax: fromPaise(totalTaxPaise),
    cgstTotal: fromPaise(cgstTotalPaise),
    sgstTotal: fromPaise(sgstTotalPaise),
    igstTotal: fromPaise(igstTotalPaise),
    hsnRows,
    interstate,
    rawTotal: fromPaise(rawTotalPaise),
    roundOff: fromPaise(roundOffPaise),
    grandTotal: fromPaise(grandTotalPaise),
    companyState,
    custState,
  };
}

/* -------- invoice lifecycle --------
   Draft -> (Finalize, locks the invoice) -> Sent -> Partially Paid -> Paid
   Overdue is a computed state (not stored) once a sent/partial invoice passes
   its due date. Cancelled is a manual terminal state. Once `finalized` is
   true, the invoice number, items, company and customer snapshot are locked;
   corrections should go through a credit/debit note or cancellation rather
   than silently editing history. */
const STATUS_META = {
  draft: { label: "Draft", bg: "#f0eee6", fg: "#7a7362" },
  sent: { label: "Sent", bg: "#eaf0fb", fg: "#2d4f8f" },
  partial: { label: "Partially Paid", bg: "#fdf3e3", fg: "#96700f" },
  paid: { label: "Paid", bg: "#eaf4ec", fg: "#2f6b3e" },
  overdue: { label: "Overdue", bg: "#fbeceb", fg: "#a13a32" },
  cancelled: { label: "Cancelled", bg: "#efefef", fg: "#7a7a7a" },
};
const STATUS_OPTIONS = Object.keys(STATUS_META).filter((s) => s !== "overdue");

const ALLOWED_TRANSITIONS = {
  draft: ["sent"],
  sent: ["partial", "paid", "cancelled"],
  partial: ["paid", "cancelled"],
  paid: [],
  cancelled: [],
};

function assertTransition(from, to) {
  if (from === to) return;
  if (!(ALLOWED_TRANSITIONS[from] || []).includes(to)) {
    throw new Error(`Invalid invoice transition: ${from || "draft"} → ${to}`);
  }
}

function sumPaise(rows, predicate) {
  return (rows || []).filter(predicate || (() => true)).reduce((sum, row) => sum + Number(row.amountPaise ?? toPaise(row.amount)), 0);
}

/** The only source of truth for a receivable; do not infer payment from status. */
export function invoiceBalance(inv, payments = [], creditNotes = [], debitNotes = [], company, customer) {
  const totalPaise = computeInvoice(inv, company, customer || inv.customerSnapshot).grandTotalPaise;
  const paymentPaise = sumPaise(payments, (p) => p.invoiceId === inv.id && p.status !== "void");
  const creditPaise = sumPaise(creditNotes, (n) => n.invoiceId === inv.id && n.status === "issued");
  const debitPaise = sumPaise(debitNotes, (n) => n.invoiceId === inv.id && n.status === "issued");
  return { totalPaise, paymentPaise, creditPaise, debitPaise, outstandingPaise: Math.max(0, totalPaise - paymentPaise - creditPaise + debitPaise) };
}

function deriveInvoiceStatus(inv, payments, creditNotes, debitNotes, company) {
  if (inv.status === "draft" || inv.status === "cancelled") return inv.status;
  const balance = invoiceBalance(inv, payments, creditNotes, debitNotes, company).outstandingPaise;
  if (balance <= 0) return "paid";
  if (balance < computeInvoice(inv, company, inv.customerSnapshot).grandTotalPaise) return "partial";
  return inv.status === "draft" ? "draft" : "sent";
}

/** Effective status for display: derives "overdue" from due date when applicable. */
function effectiveStatus(inv, outstandingPaise) {
  if ((inv.status === "sent" || inv.status === "partial") && (outstandingPaise === undefined || outstandingPaise > 0)) {
    const due = inv.dueDate || inv.invoiceDate;
    if (due && daysBetween(due) > 0 && due < todayISO()) return "overdue";
  }
  return inv.status || "draft";
}
const isFinalized = (inv) => inv.finalized === true;
const isCancelled = (inv) => inv.status === "cancelled";
/** Counts toward billed totals / reports: finalized and not cancelled. */
const isBillable = (inv) => isFinalized(inv) && !isCancelled(inv);
/** Counts toward outstanding receivables. */
const isOutstanding = (inv) => isBillable(inv) && inv.status !== "paid";

/* ============================== API field adapters ==============================
 * The backend and the existing frontend components use different field-naming
 * conventions (e.g. `companyName` vs `name`, `productName` vs `description`).
 * These adapters translate between them so every presentational component
 * below (CompanyManager, CustomerManager, InvoiceForm, History, ...) keeps
 * working completely unchanged against its original frontend-shaped data.
 */

function companyFromApi(row) {
  const extra = row.bankDetails || {};
  return {
    id: row.id, name: row.companyName, gstin: row.gstin || "", pan: extra.pan || "",
    address: row.address || "", mobile: row.phone || "", email: row.email || "",
    website: extra.website || "-", bankName: extra.bankName || "", accountNo: extra.accountNo || "",
    ifsc: extra.ifsc || "", branch: extra.branch || "",
    invoicePrefix: extra.invoicePrefix ?? "INV-", invoiceStartNumber: extra.invoiceStartNumber ?? 1,
    numberPadding: extra.numberPadding ?? 3, fyResetEnabled: !!extra.fyResetEnabled,
    logoStyle: row.logoStyle || "custom", logoColor: row.logoColor || "#C6332B",
    active: extra.active !== false,
  };
}
function companyToApi(c) {
  return {
    companyName: c.name, gstin: c.gstin || "", address: c.address || "", phone: c.mobile || "",
    email: c.email || "", state: stateFromGSTIN(c.gstin) || "", logoStyle: c.logoStyle || "custom",
    logoColor: c.logoColor || "#C6332B",
    bankDetails: {
      pan: c.pan || "", website: c.website || "-", bankName: c.bankName || "", accountNo: c.accountNo || "",
      ifsc: c.ifsc || "", branch: c.branch || "", invoicePrefix: c.invoicePrefix || "INV-",
      invoiceStartNumber: c.invoiceStartNumber || 1, numberPadding: c.numberPadding || 3,
      fyResetEnabled: !!c.fyResetEnabled, active: c.active !== false,
    },
  };
}

function customerFromApi(row) {
  return {
    id: row.id, companyId: row.companyId, name: row.name, phone: row.phone || "",
    gstin: row.gstin || "", billingAddress: row.billingAddress || "", shippingAddress: row.shippingAddress || "",
    state: row.state || stateFromGSTIN(row.gstin) || "", active: true,
  };
}
function customerToApi(c, companyId) {
  return {
    companyId, name: c.name, gstin: c.gstin || "", billingAddress: c.billingAddress || "",
    shippingAddress: c.shippingAddress || "", phone: c.phone || "", state: c.state || stateFromGSTIN(c.gstin) || "",
  };
}

function productFromApi(row) {
  return { id: row.id, companyId: row.companyId, name: row.name, description: row.description || "", hsn: row.hsnSac || "", unit: row.unit || "Nos", rate: row.rate, taxRate: row.gstRate };
}
function productToApi(p, companyId) {
  return { companyId, name: p.name, description: p.description || "", hsnSac: p.hsn || "", unit: p.unit || "Nos", rate: p.rate || 0, gstRate: Number(p.taxRate) || 0 };
}

function invoiceToApiPayload(inv) {
  return {
    companyId: inv.companyId,
    customerId: inv.customerId || null,
    invoiceDate: inv.invoiceDate,
    dueDate: inv.dueDate || null,
    notes: inv.notes || "",
    terms: inv.terms || "",
    items: (inv.items || []).map((it) => ({
      productId: it.productId || null, productName: it.description || "(no description)",
      hsnSac: it.hsn || "", quantity: it.qty, unit: it.unit || "Nos", rate: it.rate || 0, gstRate: Number(it.taxRate) || 0,
    })),
    finalize: inv.finalized === true,
  };
}
function invoiceFromApi(row) {
  const snap = row.customerSnapshot || {};
  return {
    id: row.id, companyId: row.companyId, customerId: row.customerId || "",
    customerSnapshot: {
      name: snap.name || "", phone: snap.phone || "", gstin: snap.gstin || "",
      billingAddress: snap.billing_address || snap.billingAddress || "",
      shippingAddress: snap.shipping_address || snap.shippingAddress || "",
      sameAsBilling: (snap.shipping_address || snap.shippingAddress || "") === (snap.billing_address || snap.billingAddress || ""),
      state: snap.state || stateFromGSTIN(snap.gstin) || "",
    },
    invoiceNo: row.invoiceNumber || "(assigned on save)",
    invoiceDate: (row.invoiceDate || "").slice(0, 10),
    dueDate: row.dueDate ? row.dueDate.slice(0, 10) : "",
    items: (row.items || []).map((it) => ({ id: it.id, productId: it.productId || "", description: it.productName, hsn: it.hsnSac || "", qty: it.quantity, rate: it.rate, taxRate: it.gstRate })),
    notes: row.notes || "", status: row.status, finalized: row.finalized, createdAt: row.createdAt,
    deleted: row.deleted,
  };
}

/* ============================== small UI atoms ============================== */

function Field({ label, children, hint }) {
  return (
    <label className="fld">
      <span className="fld-label">{label}</span>
      {children}
      {hint ? <span className="fld-hint">{hint}</span> : null}
    </label>
  );
}

/* Letterhead logos are served from public/logos so the main bundle stays small. */

const LOGO_SAGAR_SRC = "/logos/sagar.png";

const LOGO_SSK_SRC = "/logos/ssk.png";


function LogoSagar({ size = 40 }) {
  // Real Sagar Roadways and Enterprises mark.
  return (
    <span className="logo-img-wrap" style={{ height: size }}>
      <img src={LOGO_SAGAR_SRC} alt="Sagar Roadways and Enterprises logo" style={{ height: size }} />
    </span>
  );
}

function LogoSSK({ size = 40 }) {
  // Real S S K Roadlines mark.
  return (
    <span className="logo-img-wrap" style={{ height: size }}>
      <img src={LOGO_SSK_SRC} alt="S S K Roadlines logo" style={{ height: size }} />
    </span>
  );
}

function LogoCustom({ color = "#C6332B", size = 40 }) {
  // Generic colorable mark for companies added by the user (not one of the two source letterheads).
  const gid = "custom-" + color.replace("#", "");
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} />
          <stop offset="100%" stopColor="#3a2a1a" />
        </linearGradient>
      </defs>
      <polygon points="8,90 34,12 54,12 40,50 54,90 34,90" fill={`url(#${gid})`} />
      <polygon points="38,90 60,20 76,20 54,90" fill="#adadad" />
      <polygon points="58,90 78,26 92,26 72,90" fill="#4a4a4a" />
    </svg>
  );
}

function Logo({ style = "custom", color = "#C6332B", size = 40 }) {
  if (style === "sagar") return <LogoSagar size={size} />;
  if (style === "ssk") return <LogoSSK size={size} />;
  return <LogoCustom color={color} size={size} />;
}

function Badge({ status, invoice }) {
  const key = invoice ? effectiveStatus(invoice) : (status || "draft");
  const s = STATUS_META[key] || STATUS_META.draft;
  return <span className="badge" style={{ background: s.bg, color: s.fg }}>{s.label}</span>;
}

/* ============================== Auth ============================== */

function AuthGate({ onAuthed }) {
  const [mode, setMode] = useState("login"); // login | register
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      const user = mode === "login" ? await api.login(email.trim(), password) : await api.register(email.trim(), password);
      onAuthed(user);
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="loader" style={{ width: 340, maxWidth: "92vw" }}>
      <Logo size={44} />
      <h2 style={{ margin: "6px 0 0", fontFamily: "'Lora',serif" }}>Bilty GST Invoice Studio</h2>
      <p className="muted" style={{ marginTop: -4 }}>{mode === "login" ? "Log in to your account" : "Create your account"}</p>
      <form onSubmit={submit} style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
        <Field label="Email"><input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password" hint={mode === "register" ? "At least 8 characters" : undefined}>
          <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <div className="muted" style={{ color: "#B8433D" }}>{error}</div>}
        <button className="primary-btn" type="submit" disabled={busy}>
          {busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
        </button>
      </form>
      <button className="ghost-btn small" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
        {mode === "login" ? "Need an account? Register" : "Already have an account? Log in"}
      </button>
    </div>
  );
}

/* ============================== main app ============================== */

function useOnlineStatus() {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return online;
}

export default function App() {
  const [authUser, setAuthUser] = useState(undefined); // undefined = checking, null = logged out
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [payments, setPayments] = useState([]);
  const [creditNotes, setCreditNotes] = useState([]);
  const [debitNotes, setDebitNotes] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [view, setView] = useState("dashboard");
  const [previewId, setPreviewId] = useState(null);
  const [toast, setToast] = useState(null);
  const [navOpen, setNavOpen] = useState(false);
  const [draftInvoice, setDraftInvoice] = useState(null);
  const backupInputRef = useRef(null);
  const online = useOnlineStatus();

  useEffect(() => {
    const unsub = api.onAuthChange((u) => setAuthUser(u));
    api.fetchCurrentUser().then(setAuthUser);
    return unsub;
  }, []);

  const notify = useCallback((msg) => { setToast(msg); setTimeout(() => setToast(null), 2600); }, []);

  /** Loads every company the logged-in user owns, plus all their scoped data, from the API. */
  const loadEverything = useCallback(async () => {
    setLoading(true);
    try {
      const apiCompanies = await api.Companies.list();
      const mappedCompanies = apiCompanies.map(companyFromApi);
      setCompanies(mappedCompanies);

      const perCompany = await Promise.all(mappedCompanies.map(async (c) => {
        const [cu, pr, inv, tpl, pay, cred, deb] = await Promise.all([
          api.Customers.list(c.id), api.Products.list(c.id), api.Invoices.list(c.id),
          api.Templates.list(c.id), api.Payments.list(c.id), api.CreditNotes.list(c.id), api.DebitNotes.list(c.id),
        ]);
        return { customers: cu, products: pr, invoices: inv, templates: tpl, payments: pay, creditNotes: cred, debitNotes: deb };
      }));

      setCustomers(perCompany.flatMap((p) => p.customers).map(customerFromApi));
      setProducts(perCompany.flatMap((p) => p.products).map(productFromApi));
      setInvoices(perCompany.flatMap((p) => p.invoices).map(invoiceFromApi));
      setTemplates(perCompany.flatMap((p) => p.templates));
      setPayments(perCompany.flatMap((p) => p.payments));
      setCreditNotes(perCompany.flatMap((p) => p.creditNotes));
      setDebitNotes(perCompany.flatMap((p) => p.debitNotes));
    } catch (e) {
      notify(e.message || "Unable to load your data. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    if (authUser) loadEverything();
    else if (authUser === null) setLoading(false);
  }, [authUser, loadEverything]);

  // One-time recovery offer for a draft that was being edited when the browser/tab closed unexpectedly.
  useEffect(() => {
    if (loading || !authUser) return;
    const cached = draftCache.load();
    if (cached && !invoices.some((i) => i.id === cached.id)) {
      if (window.confirm(`Recover your unsaved invoice draft "${cached.invoiceNo || "(new invoice)"}" from earlier? Choose Cancel to discard it.`)) {
        setDraftInvoice(cached);
        setView("edit");
      } else {
        draftCache.clear();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, authUser]);

  /** Diffs a full-array "next" list (the existing UI's save pattern) into create/update/delete API calls. */
  async function diffAndSync(prevList, nextList, { create, update, remove }) {
    const prevIds = new Set(prevList.map((x) => x.id));
    const nextIds = new Set(nextList.map((x) => x.id));
    for (const item of nextList) {
      if (!prevIds.has(item.id)) await create(item);
      else {
        const before = prevList.find((x) => x.id === item.id);
        if (JSON.stringify(before) !== JSON.stringify(item)) await update(item);
      }
    }
    for (const item of prevList) {
      if (!nextIds.has(item.id)) await remove(item.id);
    }
  }

  const persistCompanies = async (next) => {
    await diffAndSync(companies, next, {
      create: async (c) => { const row = await api.Companies.create(companyToApi(c)); Object.assign(c, { id: row.id }); },
      update: async (c) => api.Companies.update(c.id, companyToApi(c)),
      remove: async (id) => api.Companies.remove(id),
    });
    await loadEverything();
  };
  const persistCustomers = async (next) => {
    await diffAndSync(customers, next, {
      create: async (c) => { const row = await api.Customers.create(customerToApi(c, c.companyId || companies[0]?.id)); Object.assign(c, { id: row.id }); },
      update: async (c) => api.Customers.update(c.id, customerToApi(c, c.companyId)),
      remove: async (id) => api.Customers.remove(id),
    });
    await loadEverything();
  };
  const persistProducts = async (next) => {
    await diffAndSync(products, next, {
      create: async (p) => { const row = await api.Products.create(productToApi(p, p.companyId || companies[0]?.id)); Object.assign(p, { id: row.id }); },
      update: async (p) => api.Products.update(p.id, productToApi(p, p.companyId)),
      remove: async (id) => api.Products.remove(id),
    });
    await loadEverything();
  };
  const persistTemplates = async (next) => {
    await diffAndSync(templates, next, {
      create: async (t) => api.Templates.create({ companyId: t.companyId, customerId: t.customerId || null, name: t.name, payload: { customerSnapshot: t.customerSnapshot, items: t.items, notes: t.notes } }),
      update: async () => {}, // recurring templates are simple append/remove in the existing UI
      remove: async (id) => api.Templates.remove(id),
    });
    await loadEverything();
  };

  const audit = async () => { /* the server now writes its own audit trail on every invoice action */ };

  const saveInvoice = async (inv) => {
    const original = invoices.find((i) => i.id === inv.id);
    const exists = !!original;
    try {
      if (exists) {
        const row = await api.Invoices.update(inv.id, invoiceToApiPayload(inv));
        setInvoices((prev) => prev.map((i) => (i.id === inv.id ? invoiceFromApi(row) : i)));
      } else {
        const row = await api.Invoices.create(invoiceToApiPayload(inv));
        setInvoices((prev) => [invoiceFromApi(row), ...prev]);
      }
      draftCache.clear();
      notify(exists ? "Invoice updated" : "Invoice created");
    } catch (e) {
      throw new Error(e.message || "Unable to save invoice. Please check your connection and try again.");
    }
  };
  const deleteInvoice = async (id) => {
    const inv = invoices.find((i) => i.id === id);
    if (!inv) return;
    if (inv.finalized && !window.confirm("This invoice has been finalized. Removing it is permanent and will keep it out of history for audit purposes. Continue?")) return;
    await api.Invoices.remove(id);
    setInvoices((prev) => prev.filter((i) => i.id !== id));
    notify(inv.finalized ? "Invoice removed" : "Draft invoice deleted");
  };
  const setInvoiceStatus = async (id, status) => {
    const inv = invoices.find((i) => i.id === id); if (!inv) return;
    try {
      const row = status === "cancelled" ? await api.Invoices.cancel(id) : await api.Invoices.setStatus(id, status);
      setInvoices((prev) => prev.map((i) => (i.id === id ? invoiceFromApi(row) : i)));
    } catch (e) {
      notify(e.message || "Unable to change invoice status.");
    }
  };
  const recordPayment = async (payment) => {
    const inv = invoices.find((i) => i.id === payment.invoiceId); if (!inv || !isBillable(inv)) throw new Error("Payments can only be recorded against finalized, active invoices.");
    const company = companyById(inv.companyId);
    const balance = invoiceBalance(inv, payments, creditNotes, debitNotes, company).outstandingPaise;
    const amountPaise = toPaise(payment.amount);
    if (amountPaise <= 0 || amountPaise > balance) throw new Error("Payment must be greater than zero and cannot exceed the outstanding balance.");
    const row = await api.Payments.create({
      companyId: inv.companyId, invoiceId: inv.id, amount: fromPaise(amountPaise),
      method: payment.paymentMethod || "bank_transfer", reference: payment.referenceNumber || "", paidOn: payment.paymentDate || todayISO(),
    });
    const saved = { id: row.id, invoiceId: inv.id, companyId: inv.companyId, customerId: inv.customerId, amountPaise, paymentDate: row.paidOn, paymentMethod: row.method, referenceNumber: row.reference, bankAccount: payment.bankAccount || "", notes: payment.notes || "", createdAt: row.createdAt };
    const nextPayments = [saved, ...payments]; setPayments(nextPayments);
    const status = deriveInvoiceStatus(inv, nextPayments, creditNotes, debitNotes, company);
    if (status !== inv.status) {
      const updated = await api.Invoices.setStatus(inv.id, status);
      setInvoices((prev) => prev.map((i) => (i.id === inv.id ? invoiceFromApi(updated) : i)));
    }
    notify("Payment recorded");
  };

  const companyById = useCallback((id) => companies.find((c) => c.id === id), [companies]);

  /** Invoice numbers are assigned atomically by the backend (per company, sequential) — this is display-only until save. */
  const nextInvoiceNo = useCallback(() => "(assigned on save)", []);
  /** The backend enforces uniqueness per company; nothing to check client-side. */
  const isDuplicateInvoiceNo = useCallback(() => false, []);

  const openNewInvoice = (base) => {
    const company = base?.companyId ? companyById(base.companyId) : companies[0];
    const inv = base
      ? { ...JSON.parse(JSON.stringify(base)), id: uid() }
      : {
        id: uid(), companyId: company ? company.id : "", customerId: "",
        customerSnapshot: { name: "", phone: "", gstin: "", billingAddress: "", shippingAddress: "", sameAsBilling: true, state: "" },
        invoiceNo: "(assigned on save)",
        invoiceDate: todayISO(), items: [], notes: "", status: "draft", finalized: false, createdAt: Date.now(),
      };
    setDraftInvoice(inv);
    setView("edit");
  };

  const openEdit = (inv) => { setDraftInvoice(JSON.parse(JSON.stringify(inv))); setView("edit"); };

  /** "Duplicate & Correct": server preserves the original (incl. if cancelled) and mints a fresh invoice number. */
  const duplicateInvoice = async (inv) => {
    try {
      const row = await api.Invoices.duplicate(inv.id);
      const created = invoiceFromApi(row);
      setInvoices((prev) => [created, ...prev]);
      setDraftInvoice(created);
      setView("edit");
      notify(`Created ${created.invoiceNo} from ${inv.invoiceNo} — edit and finalize when ready`);
    } catch (e) {
      notify(e.message || "Unable to duplicate this invoice.");
    }
  };

  const generateFromTemplate = (tpl) => {
    const date = todayISO();
    const payload = tpl.payload || {};
    const range = prevMonthRange(date);
    const inv = {
      id: uid(), companyId: tpl.companyId, customerId: tpl.customerId || "",
      customerSnapshot: JSON.parse(JSON.stringify(payload.customerSnapshot || { name: "", phone: "", gstin: "", billingAddress: "", shippingAddress: "", sameAsBilling: true, state: "" })),
      invoiceNo: "(assigned on save)",
      invoiceDate: date,
      items: (payload.items || []).map((it) => ({ ...it, id: uid(), description: (it.description || "").replace(/\(.*\)$/, `(${range})`) })),
      notes: payload.notes || "", status: "draft", finalized: false, createdAt: Date.now(),
    };
    setDraftInvoice(inv);
    setView("edit");
  };

  /** Export-only now: your data lives in the cloud, so this is a point-in-time snapshot for your own records, not a restore mechanism. */
  const exportBackup = () => {
    const blob = { version: 3, companies, customers, products, invoices, templates, payments, creditNotes, debitNotes, exportedAt: new Date().toISOString() };
    const data = "data:application/json;charset=utf-8," + encodeURIComponent(JSON.stringify(blob, null, 2));
    const a = document.createElement("a"); a.href = data; a.download = "bilty-backup.json"; a.click();
  };

  const stats = useMemo(() => {
    let totalAmt = 0, outstanding = 0, collected = 0, paidCount = 0, unpaidCount = 0;
    const monthly = {};
    invoices.filter(isBillable).forEach((inv) => {
      const company = companyById(inv.companyId);
      const { grandTotal } = computeInvoice(inv, company, inv.customerSnapshot);
      totalAmt += grandTotal;
      const balance = invoiceBalance(inv, payments, creditNotes, debitNotes, company).outstandingPaise;
      collected += invoiceBalance(inv, payments, creditNotes, debitNotes, company).paymentPaise / 100;
      if (balance === 0) paidCount++; else { unpaidCount++; outstanding += balance / 100; }
      const mKey = (inv.invoiceDate || "").slice(0, 7);
      monthly[mKey] = (monthly[mKey] || 0) + grandTotal;
    });
    const months = Object.keys(monthly).sort().slice(-6);
    const maxMonthly = Math.max(1, ...months.map((m) => monthly[m]));
    return { totalAmt, outstanding, collected, paidCount, unpaidCount, months, monthly, maxMonthly, count: invoices.length };
  }, [invoices, payments, creditNotes, debitNotes, companyById]);

  if (authUser === undefined) {
    return (
      <div className="app-shell center-loading">
        <style>{GLOBAL_CSS}</style>
        <div className="loader"><Logo size={44} /><p>Checking your session…</p></div>
      </div>
    );
  }
  if (!authUser) {
    return (
      <div className="app-shell center-loading">
        <style>{GLOBAL_CSS}</style>
        <AuthGate onAuthed={(u) => setAuthUser(u)} />
      </div>
    );
  }
  if (loading) {
    return (
      <div className="app-shell center-loading">
        <style>{GLOBAL_CSS}</style>
        <div className="loader"><Logo size={44} /><p>Loading your ledger…</p></div>
      </div>
    );
  }

  const NAV = [
    ["dashboard", "Dashboard"],
    ["new", "New Invoice"],
    ["history", "Invoice History"],
    ["payments", "Payments"],
    ["ledger", "Customer Ledger"],
    ["tracker", "Company Tracking"],
    ["recurring", "Recurring Bills"],
    ["reports", "Reports"],
    ["companies", "My Companies"],
    ["customers", "Customers"],
    ["products", "Products"],
  ];

  return (
    <div className="app-shell">
      <style>{GLOBAL_CSS}</style>

      <aside className={"sidebar" + (navOpen ? " open" : "")}>
        <div className="brand">
          <Logo />
          <div><div className="brand-title">Bilty</div><div className="brand-sub">GST Invoice Studio</div></div>
        </div>
        <nav>
          {NAV.map(([key, label]) => (
            <button key={key}
              className={"nav-btn" + (view === key || (key === "new" && view === "edit") ? " active" : "")}
              onClick={() => { setNavOpen(false); if (key === "new") openNewInvoice(); else setView(key); }}>
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="row-gap" style={{ marginBottom: 8 }}>
            <span className={"badge"} style={{ background: online ? "#dcfce7" : "#fee2e2", color: online ? "#166534" : "#991b1b" }}>
              {online ? "● Online — synced" : "● Offline — changes will sync when reconnected"}
            </span>
          </div>
          <div className="row-gap">
            <button className="ghost-btn small" onClick={exportBackup}>Export backup</button>
            <button className="ghost-btn small" onClick={async () => { await api.logout(); setAuthUser(null); }}>Log out</button>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{authUser.email}</div>
        </div>
      </aside>

      <button className="menu-toggle" onClick={() => setNavOpen((v) => !v)}>☰</button>

      {!online && <div className="offline-banner">You're offline. You can keep working — changes will sync automatically once your connection is back.</div>}

      <main className="main-area">
        {view === "dashboard" && (
          <Dashboard stats={stats} companies={companies} invoices={invoices} companyById={companyById}
            onNew={() => openNewInvoice()} onOpenHistory={() => setView("history")} onView={(id) => setPreviewId(id)}
            onOpenTracker={() => setView("tracker")} />
        )}

        {view === "edit" && draftInvoice && (
          <InvoiceForm
            key={draftInvoice.id}
            draft={draftInvoice}
            setDraft={setDraftInvoice}
            companies={companies}
            customers={customers}
            products={products}
            persistCustomers={persistCustomers}
            nextInvoiceNo={nextInvoiceNo}
            isDuplicateInvoiceNo={isDuplicateInvoiceNo}
            templates={templates}
            persistTemplates={persistTemplates}
            notify={notify}
            online={online}
            onCancel={() => { draftCache.clear(); setView("history"); }}
            onSave={async (finalInv) => { await saveInvoice(finalInv); setView("history"); }}
            onPreview={(inv) => { setDraftInvoice(inv); setPreviewId(inv.id); }}
          />
        )}

        {view === "history" && (
          <History invoices={invoices} companies={companies} companyById={companyById}
            onEdit={openEdit} onDelete={deleteInvoice} onDuplicate={duplicateInvoice}
            onView={(id) => setPreviewId(id)} onStatus={setInvoiceStatus} />
        )}

        {view === "payments" && <Payments invoices={invoices} payments={payments} creditNotes={creditNotes} debitNotes={debitNotes} companyById={companyById} onRecord={recordPayment} onView={(id) => setPreviewId(id)} />}

        {view === "ledger" && (
          <CustomerLedger invoices={invoices} customers={customers} payments={payments} creditNotes={creditNotes} debitNotes={debitNotes} companyById={companyById} onView={(id) => setPreviewId(id)} onRecord={recordPayment} />
        )}

        {view === "tracker" && (
          <CompanyTracker invoices={invoices} companies={companies} companyById={companyById} onView={(id) => setPreviewId(id)} />
        )}

        {view === "recurring" && (
          <Recurring templates={templates} companies={companies} customers={customers}
            persistTemplates={persistTemplates} notify={notify} onGenerate={generateFromTemplate} />
        )}

        {view === "reports" && (
          <Reports invoices={invoices} companies={companies} companyById={companyById} />
        )}

        {view === "companies" && <CompanyManager companies={companies} invoices={invoices} onSave={persistCompanies} notify={notify} />}
        {view === "customers" && <CustomerManager customers={customers} invoices={invoices} onSave={persistCustomers} notify={notify} />}
        {view === "products" && <ProductManager products={products} companies={companies} onSave={persistProducts} notify={notify} />}
      </main>

      {previewId && (() => {
        // Prefer the live draft over the persisted copy only while still in the editor:
        // previewing an invoice that's still open for edits should reflect unsaved changes,
        // but browsing to a saved invoice from History/Ledger/etc. must show the saved data,
        // not a stale draft left over from a previous, possibly-cancelled edit session.
        const liveDraft = view === "edit" && draftInvoice && draftInvoice.id === previewId ? draftInvoice : null;
        const inv = liveDraft || invoices.find((i) => i.id === previewId) || draftInvoice;
        if (!inv) return null;
        const company = companyById(inv.companyId);
        return <PreviewModal invoice={inv} company={company} onClose={() => setPreviewId(null)} />;
      })()}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/* ============================== Dashboard ============================== */

function Dashboard({ stats, companies, invoices, companyById, onNew, onOpenHistory, onView, onOpenTracker }) {
  const recent = invoices.slice(0, 6);

  const extra = useMemo(() => {
    const companyMap = {};
    companies.forEach((c) => { companyMap[c.id] = { company: c, billed: 0, outstanding: 0 }; });
    const debtorMap = {};
    let overdue30 = 0, thisMonthTotal = 0;
    const thisMonthKey = todayISO().slice(0, 7);
    const unpaidList = [];

    invoices.filter(isBillable).forEach((inv) => {
      const company = companyById(inv.companyId);
      const { grandTotal } = computeInvoice(inv, company, inv.customerSnapshot);
      if (companyMap[inv.companyId]) companyMap[inv.companyId].billed += grandTotal;
      if ((inv.invoiceDate || "").slice(0, 7) === thisMonthKey) thisMonthTotal += grandTotal;

      if (inv.status !== "paid") {
        if (companyMap[inv.companyId]) companyMap[inv.companyId].outstanding += grandTotal;
        const name = inv.customerSnapshot?.name || "Unknown";
        debtorMap[name] = (debtorMap[name] || 0) + grandTotal;
        const days = daysBetween(inv.invoiceDate);
        if (days > 30) overdue30 += grandTotal;
        unpaidList.push({ inv, company, grandTotal, days });
      }
    });

    const companyBreakdown = Object.values(companyMap).sort((a, b) => b.billed - a.billed);
    const maxCompanyBilled = Math.max(1, ...companyBreakdown.map((c) => c.billed));
    const topDebtors = Object.entries(debtorMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const needsAttention = unpaidList.sort((a, b) => b.days - a.days).slice(0, 5);
    const billableCount = invoices.filter(isBillable).length;
    const avgInvoice = billableCount ? stats.totalAmt / billableCount : 0;

    return { companyBreakdown, maxCompanyBilled, topDebtors, needsAttention, overdue30, thisMonthTotal, avgInvoice };
  }, [invoices, companies, companyById, stats.totalAmt]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">{dispDate(todayISO())} · Everything you've billed, across {companies.length} compan{companies.length === 1 ? "y" : "ies"}, at a glance.</p>
        </div>
        <div className="row-gap">
          <button className="ghost-btn" onClick={onOpenTracker}>Company tracking</button>
          <button className="primary-btn" onClick={onNew}>+ New Invoice</button>
        </div>
      </div>

      <div className="stat-grid stat-grid-6">
        <div className="stat-card"><span className="stat-label">Total invoiced</span><span className="stat-value">₹{fmt(stats.totalAmt)}</span></div>
        <div className="stat-card"><span className="stat-label">Outstanding</span><span className="stat-value warn">₹{fmt(stats.outstanding)}</span></div>
        <div className="stat-card"><span className="stat-label">Collected</span><span className="stat-value" style={{ color: "var(--green)" }}>₹{fmt(stats.collected)}</span></div>
        <div className="stat-card"><span className="stat-label">This month</span><span className="stat-value">₹{fmt(extra.thisMonthTotal)}</span></div>
        <div className="stat-card"><span className="stat-label">Avg. invoice</span><span className="stat-value">₹{fmt(extra.avgInvoice)}</span></div>
        <div className="stat-card"><span className="stat-label">Overdue 30d+</span><span className="stat-value" style={{ color: extra.overdue30 > 0 ? "var(--red)" : "inherit" }}>₹{fmt(extra.overdue30)}</span></div>
      </div>

      <div className="dash-grid">
        <div className="dash-col-main">
          {stats.months.length > 0 && (
            <div className="card">
              <h3>Last {stats.months.length} months</h3>
              <div className="bar-chart">
                {stats.months.map((m) => (
                  <div className="bar-col" key={m}>
                    <div className="bar-track"><div className="bar-fill" style={{ height: `${Math.max(4, (stats.monthly[m] / stats.maxMonthly) * 100)}%` }} /></div>
                    <span className="bar-amt">₹{Math.round(stats.monthly[m] / 1000)}k</span>
                    <span className="bar-label">{m}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-head-row"><h3>Recent invoices</h3><button className="link-btn" onClick={onOpenHistory}>View all →</button></div>
            {recent.length === 0 ? <p className="muted">No invoices yet. Create your first one to see it here.</p> : (
              <table className="table">
                <thead><tr><th>Invoice</th><th>Company</th><th>Customer</th><th>Date</th><th>Amount</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {recent.map((inv) => {
                    const company = companyById(inv.companyId);
                    const { grandTotal } = computeInvoice(inv, company, inv.customerSnapshot);
                    return (
                      <tr key={inv.id}>
                        <td>{inv.invoiceNo}</td><td>{company?.name || "—"}</td><td>{inv.customerSnapshot?.name || "—"}</td>
                        <td>{dispDate(inv.invoiceDate)}</td><td>₹{fmt(grandTotal)}</td><td><Badge invoice={inv} /></td>
                        <td><button className="link-btn" onClick={() => onView(inv.id)}>View</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="dash-col-side">
          <div className="card">
            <h3>By company</h3>
            {extra.companyBreakdown.length === 0 ? <p className="muted small">No companies yet.</p> : (
              <div className="company-bars">
                {extra.companyBreakdown.map(({ company, billed, outstanding }) => (
                  <div className="company-bar-row" key={company.id}>
                    <div className="row-gap" style={{ alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <Logo style={company.logoStyle} color={company.logoColor} size={22} />
                      <span className="company-bar-name">{company.name || "Untitled"}</span>
                    </div>
                    <div className="company-bar-track">
                      <div className="company-bar-fill" style={{ width: `${Math.max(2, (billed / extra.maxCompanyBilled) * 100)}%` }} />
                    </div>
                    <div className="company-bar-figures">
                      <span>₹{fmt(billed)} billed</span>
                      {outstanding > 0 && <span className="warn">₹{fmt(outstanding)} due</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <h3>Top outstanding customers</h3>
            {extra.topDebtors.length === 0 ? <p className="muted small">Nobody owes you right now 🎉</p> : (
              <ul className="side-list">
                {extra.topDebtors.map(([name, amt]) => (
                  <li key={name}><span>{name}</span><span className="warn">₹{fmt(amt)}</span></li>
                ))}
              </ul>
            )}
          </div>

          <div className="card">
            <h3>Needs attention</h3>
            {extra.needsAttention.length === 0 ? <p className="muted small">No unpaid invoices outstanding.</p> : (
              <ul className="side-list">
                {extra.needsAttention.map(({ inv, grandTotal, days }) => (
                  <li key={inv.id} className="side-list-click" onClick={() => onView(inv.id)}>
                    <span>{inv.customerSnapshot?.name || "—"} <span className="muted small">· {inv.invoiceNo}</span></span>
                    <span className="warn">{days}d · ₹{fmt(grandTotal)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================== Invoice Form ============================== */

function InvoiceForm({ draft, setDraft, companies, customers, products, persistCustomers, nextInvoiceNo, isDuplicateInvoiceNo, templates, persistTemplates, notify, online, onCancel, onSave, onPreview }) {
  const company = companies.find((c) => c.id === draft.companyId);
  const companyProducts = (products || []).filter((p) => p.companyId === draft.companyId);
  const [saveAsCustomer, setSaveAsCustomer] = useState(false);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);

  const update = (patch) => setDraft({ ...draft, ...patch });
  const updateCust = (patch) => setDraft({ ...draft, customerSnapshot: { ...draft.customerSnapshot, ...patch } });

  const pickCustomer = (id) => {
    const c = customers.find((x) => x.id === id);
    if (!c) { update({ customerId: "", customerSnapshot: { name: "", phone: "", gstin: "", billingAddress: "", shippingAddress: "", sameAsBilling: true, state: "" } }); return; }
    update({
      customerId: id,
      customerSnapshot: {
        name: c.name, phone: c.phone, gstin: c.gstin,
        billingAddress: c.billingAddress, shippingAddress: c.shippingAddress || c.billingAddress,
        sameAsBilling: !c.shippingAddress || c.shippingAddress === c.billingAddress,
        state: c.state || stateFromGSTIN(c.gstin),
      },
    });
  };

  const addItem = (preset) => {
    const range = prevMonthRange(draft.invoiceDate);
    const item = { id: uid(), description: preset ? `${preset.desc} (${range})` : "", hsn: preset ? preset.hsn : "", qty: 1, rate: "", taxRate: 18 };
    update({ items: [...draft.items, item] });
  };
  const addFromProduct = (productId) => {
    const p = (products || []).find((x) => x.id === productId);
    if (!p) return;
    const item = { id: uid(), productId: p.id, description: p.description || p.name, hsn: p.hsn || "", qty: 1, rate: p.rate, taxRate: p.taxRate, unit: p.unit || "Nos" };
    update({ items: [...draft.items, item] });
  };
  const updateItem = (id, patch) => update({ items: draft.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
  const removeItem = (id) => update({ items: draft.items.filter((i) => i.id !== id) });

  const totals = computeInvoice(draft, company, draft.customerSnapshot);
  const handleCompanyChange = (id) => update({ companyId: id, invoiceNo: nextInvoiceNo(id, draft.invoiceDate) });
  const locked = draft.finalized === true;

  const companyGstin = validateGSTIN(company?.gstin);
  const custGstin = validateGSTIN(draft.customerSnapshot.gstin);
  const stateMismatch = draft.customerSnapshot.gstin && custGstin.valid && draft.customerSnapshot.state
    && custGstin.state !== draft.customerSnapshot.state;

  const validate = () => {
    if (!draft.companyId) return "Choose which of your companies is issuing this invoice.";
    if (!draft.customerSnapshot.name) return "Add the customer's name.";
    if (!draft.invoiceNo) return "Invoice number is required.";
    if (draft.customerSnapshot.gstin && !custGstin.valid) return "Customer GSTIN: " + custGstin.reason;
    if (isDuplicateInvoiceNo(draft.companyId, draft.invoiceNo, draft.id)) return "Invoice number already exists for this company.";
    if (draft.items.length === 0) return "Add at least one line item.";
    for (const it of draft.items) {
      if (!it.description) return "Every line item needs a description.";
      if (!it.rate || toPaise(it.rate) <= 0) return "Every line item needs a rate greater than 0.";
      if (!it.hsn) return "Every line item needs an HSN/SAC code.";
    }
    return null;
  };

  const [err, setErr] = useState("");

  const persistCustomerAndTemplateIfNeeded = async () => {
    if (saveAsCustomer && draft.customerSnapshot.name) {
      const exists = customers.find((c) => c.gstin && c.gstin === draft.customerSnapshot.gstin);
      if (!exists) await persistCustomers([...customers, { id: uid(), ...draft.customerSnapshot }]);
    }
    if (saveAsTemplate) {
      await persistTemplates([...templates, {
        id: uid(), name: `${draft.customerSnapshot.name} — ${company?.name || ""}`,
        companyId: draft.companyId, customerId: draft.customerId, customerSnapshot: draft.customerSnapshot,
        items: draft.items, notes: draft.notes,
      }]);
      notify("Saved as recurring template");
    }
  };

  const doSave = async (goPreviewAfter) => {
    const problem = validate();
    if (problem) { setErr(problem); return; }
    setErr("");
    try { await persistCustomerAndTemplateIfNeeded(); if (goPreviewAfter) onPreview(draft); else await onSave(draft); }
    catch (e) { setErr(e.message || "Unable to save the invoice. Please retry."); }
  };

  const doFinalize = async () => {
    const problem = validate();
    if (problem) { setErr(problem); return; }
    setErr("");
    try {
      await persistCustomerAndTemplateIfNeeded();
      const finalized = { ...draft, finalized: true, status: draft.status === "draft" ? "sent" : draft.status };
      setDraft(finalized); await onSave(finalized); notify("Invoice finalized and locked");
    } catch (e) { setErr(e.message || "Unable to finalize the invoice. Please retry."); }
  };

  /**
   * Local-only autosave: recovers this in-progress draft if the browser/tab
   * closes unexpectedly. The server remains the source of truth — this cache
   * is cleared as soon as the invoice is actually saved to the backend.
   */
  const [autosavedAt, setAutosavedAt] = useState(null);
  useEffect(() => {
    if (locked) return;
    const t = setTimeout(() => { draftCache.save(draft); setAutosavedAt(new Date()); }, 600);
    return () => clearTimeout(t);
  }, [draft, locked]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{draft.invoiceNo ? "Editing " + draft.invoiceNo : "New Invoice"}</h1>
          <p className="muted">
            {locked ? "This invoice is finalized and locked — company, items and invoice number can't be edited. Use a credit/debit note or cancel it for corrections." : "Fill in the details — totals and tax split calculate automatically."}
            {!locked && autosavedAt && <span> · Draft saved {online ? "" : "locally (offline)"} at {autosavedAt.toLocaleTimeString()}</span>}
          </p>
        </div>
        <div className="row-gap">
          <button className="ghost-btn" onClick={onCancel}>Cancel</button>
          <button className="ghost-btn" onClick={() => doSave(true)}>Preview</button>
          <button className="primary-btn" onClick={() => doSave(false)} disabled={!online}>Save {locked ? "" : "Draft"}</button>
          {!locked && <button className="primary-btn" onClick={doFinalize} disabled={!online}>Finalize &amp; Lock</button>}
        </div>
      </div>

      {!online && <div className="error-banner" style={{ background: "#FEF3C7", color: "#92400E", borderColor: "#FDE68A" }}>You're offline. This draft is being saved on your device and will sync automatically once you're back online — Save and Finalize are disabled until then.</div>}
      {err && <div className="error-banner">{err}</div>}
      {locked && <div className="error-banner" style={{ background: "#EAF0FB", color: "#2d4f8f", borderColor: "#C7D7F0" }}>🔒 Finalized invoice — locked fields are grayed out below.</div>}

      <div className="grid-2">
        <div className="card">
          <h3>Issuing company</h3>
          <Field label="Company">
            <select value={draft.companyId} onChange={(e) => handleCompanyChange(e.target.value)} disabled={locked}>
              <option value="">Select company…</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          {company?.gstin && !companyGstin.valid && (
            <p className="muted small" style={{ color: "var(--red)" }}>⚠ Issuing company GSTIN looks invalid: {companyGstin.reason}. Fix this under My Companies.</p>
          )}
          <div className="two-col">
            <Field label="Invoice No."><input value={draft.invoiceNo} onChange={(e) => update({ invoiceNo: e.target.value })} disabled={locked} /></Field>
            <Field label="Invoice Date"><input type="date" value={draft.invoiceDate} onChange={(e) => update({ invoiceDate: e.target.value })} disabled={locked} /></Field>
          </div>
          <div className="two-col">
            <Field label="Due date" hint="Used to flag invoices overdue"><input type="date" value={draft.dueDate || ""} onChange={(e) => update({ dueDate: e.target.value })} disabled={locked} /></Field>
            <Field label="Status"><input value={STATUS_META[draft.status || "draft"].label} disabled /></Field>
          </div>
        </div>

        <div className="card">
          <h3>Customer</h3>
          <Field label="Load saved customer (optional)">
            <select value={draft.customerId} onChange={(e) => pickCustomer(e.target.value)} disabled={locked}>
              <option value="">— enter manually —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Customer / Company name"><input value={draft.customerSnapshot.name} onChange={(e) => updateCust({ name: e.target.value })} disabled={locked} /></Field>
          <div className="two-col">
            <Field label="Phone"><input value={draft.customerSnapshot.phone} onChange={(e) => updateCust({ phone: e.target.value })} disabled={locked} /></Field>
            <Field label="GSTIN">
              <input value={draft.customerSnapshot.gstin} disabled={locked}
                onChange={(e) => { const g = e.target.value.toUpperCase(); updateCust({ gstin: g, state: stateFromGSTIN(g) }); }} />
            </Field>
          </div>
          {draft.customerSnapshot.gstin && !custGstin.valid && (
            <p className="muted small" style={{ color: "var(--red)" }}>⚠ {custGstin.reason}</p>
          )}
          {draft.customerSnapshot.gstin && custGstin.valid && (
            <p className="muted small">
              Detected state: {custGstin.state} — {totals.interstate ? "IGST will apply (interstate)" : "CGST + SGST will apply (same state)"}
              {stateMismatch && <span style={{ color: "var(--red)" }}> · ⚠ GSTIN state does not match selected state</span>}
            </p>
          )}
          <Field label="Billing address"><textarea rows={3} value={draft.customerSnapshot.billingAddress} onChange={(e) => updateCust({ billingAddress: e.target.value })} disabled={locked} /></Field>
          <label className="checkbox-row">
            <input type="checkbox" checked={draft.customerSnapshot.sameAsBilling} disabled={locked}
              onChange={(e) => updateCust({ sameAsBilling: e.target.checked, shippingAddress: e.target.checked ? draft.customerSnapshot.billingAddress : draft.customerSnapshot.shippingAddress })} />
            Shipping address same as billing
          </label>
          {!draft.customerSnapshot.sameAsBilling && (
            <Field label="Shipping address"><textarea rows={3} value={draft.customerSnapshot.shippingAddress} onChange={(e) => updateCust({ shippingAddress: e.target.value })} disabled={locked} /></Field>
          )}
          {!locked && <>
            <label className="checkbox-row"><input type="checkbox" checked={saveAsCustomer} onChange={(e) => setSaveAsCustomer(e.target.checked)} /> Save this customer for next time</label>
            <label className="checkbox-row"><input type="checkbox" checked={saveAsTemplate} onChange={(e) => setSaveAsTemplate(e.target.checked)} /> Save as a recurring template</label>
          </>}
        </div>
      </div>

      <div className="card">
        <div className="card-head-row">
          <h3>Line items</h3>
          {!locked && (
            <div className="row-gap">
              {companyProducts.length > 0 && (
                <select className="chip-btn" style={{ cursor: "pointer" }} value="" onChange={(e) => { addFromProduct(e.target.value); e.target.value = ""; }}>
                  <option value="" disabled>+ From product catalog…</option>
                  {companyProducts.map((p) => <option key={p.id} value={p.id}>{p.name} — ₹{fmt(p.rate)}</option>)}
                </select>
              )}
              {HSN_PRESETS.map((p) => <button key={p.hsn} className="chip-btn" onClick={() => addItem(p)}>+ {p.label}</button>)}
              <button className="chip-btn" onClick={() => addItem(null)}>+ Blank line</button>
            </div>
          )}
        </div>

        {draft.items.length === 0 ? <p className="muted">No line items yet — add one above.</p> : (
          <table className="table items-table">
            <thead><tr><th style={{ width: "34%" }}>Description</th><th>HSN/SAC</th><th>Qty</th><th>Rate</th><th>Tax %</th><th>Amount</th><th></th></tr></thead>
            <tbody>
              {draft.items.map((it) => (
                <tr key={it.id}>
                  <td><textarea rows={2} value={it.description} onChange={(e) => updateItem(it.id, { description: e.target.value })} disabled={locked} /></td>
                  <td><input className="narrow" value={it.hsn} onChange={(e) => updateItem(it.id, { hsn: e.target.value })} disabled={locked} placeholder="required" /></td>
                  <td><input className="narrow" type="number" value={it.qty} onChange={(e) => updateItem(it.id, { qty: e.target.value })} disabled={locked} /></td>
                  <td><input className="narrow" type="number" value={it.rate} onChange={(e) => updateItem(it.id, { rate: e.target.value })} disabled={locked} /></td>
                  <td><select value={it.taxRate} onChange={(e) => updateItem(it.id, { taxRate: e.target.value })} disabled={locked}>{TAX_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}</select></td>
                  <td className="num">₹{fmt(fromPaise(lineAmountPaise(it.qty, it.rate)))}</td>
                  {!locked && <td><button className="icon-btn" onClick={() => removeItem(it.id)} title="Remove">✕</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Field label="Notes (optional)"><textarea rows={2} value={draft.notes} onChange={(e) => update({ notes: e.target.value })} placeholder="Any terms, PO reference, etc." /></Field>
      </div>

      <div className="card totals-card">
        <div className="totals-row"><span>Taxable amount</span><span>₹{fmt(totals.taxable)}</span></div>
        {totals.interstate ? (
          <div className="totals-row"><span>IGST</span><span>₹{fmt(totals.totalTax)}</span></div>
        ) : (
          <>
            <div className="totals-row"><span>CGST</span><span>₹{fmt(totals.cgstTotal)}</span></div>
            <div className="totals-row"><span>SGST</span><span>₹{fmt(totals.sgstTotal)}</span></div>
          </>
        )}
        {Math.abs(totals.roundOff) > 0.001 && <div className="totals-row"><span>Round off</span><span>{totals.roundOff >= 0 ? "+" : ""}₹{fmt(totals.roundOff)}</span></div>}
        <div className="totals-row grand"><span>Amount payable</span><span>₹{fmt(totals.grandTotal)}</span></div>
      </div>
    </div>
  );
}

/* ============================== History ============================== */

function History({ invoices, companies, companyById, onEdit, onDelete, onDuplicate, onView, onStatus }) {
  const [q, setQ] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);

  const filtered = invoices.filter((inv) => {
    if (companyFilter && inv.companyId !== companyFilter) return false;
    if (statusFilter && inv.status !== statusFilter) return false;
    if (q) {
      const hay = (inv.invoiceNo + " " + (inv.customerSnapshot?.name || "")).toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });
useEffect(() => {
    console.log("update");
  }, []);

  return (
    <div className="page">
      <div className="page-head"><div><h1>Invoice History</h1><p className="muted">{invoices.length} invoice{invoices.length === 1 ? "" : "s"} on record.</p></div></div>

      <div className="filters-row">
        <input placeholder="Search invoice # or customer…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)}>
          <option value="">All companies</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>
      </div>

      <div className="card">
        {filtered.length === 0 ? <p className="muted">No invoices match.</p> : (
          <table className="table">
            <thead><tr><th>Invoice</th><th>Company</th><th>Customer</th><th>Date</th><th>Amount</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {filtered.map((inv) => {
                const company = companyById(inv.companyId);
                const { grandTotal } = computeInvoice(inv, company, inv.customerSnapshot);
                const locked = isFinalized(inv);
                return (
                  <tr key={inv.id}>
                    <td>{inv.invoiceNo} {locked && <span title="Finalized & locked">🔒</span>}</td>
                    <td>{company?.name || "—"}</td><td>{inv.customerSnapshot?.name || "—"}</td>
                    <td>{dispDate(inv.invoiceDate)}</td><td>₹{fmt(grandTotal)}</td>
                    <td>
                      <select className="status-select" value={inv.status} onChange={async (e) => { try { await onStatus(inv.id, e.target.value); } catch (err) { window.alert(err.message); } }}>
                        {[inv.status, ...(ALLOWED_TRANSITIONS[inv.status] || [])].filter((s, index, a) => a.indexOf(s) === index).map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
                      </select>
                    </td>
                    <td className="row-actions">
                      <button className="link-btn" onClick={() => onView(inv.id)}>View</button>
                      <button className="link-btn" onClick={() => onEdit(inv)}>{locked ? "View/Amend" : "Edit"}</button>
                      <button className="link-btn" onClick={() => onDuplicate(inv)}>Duplicate</button>
                      {locked ? (
                        inv.status !== "cancelled" && <button className="link-btn danger" onClick={() => onStatus(inv.id, "cancelled")}>Cancel</button>
                      ) : (
                        <button className="link-btn danger" onClick={() => setConfirmDelete(inv.id)}>Delete</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {confirmDelete && (
        <div className="modal-backdrop" onClick={() => setConfirmDelete(null)}>
          <div className="modal small" onClick={(e) => e.stopPropagation()}>
            <h3>Delete this invoice?</h3><p className="muted">This can't be undone. (Only draft invoices can be deleted — finalized invoices must be cancelled instead, to keep a clean audit trail.)</p>
            <div className="row-gap end">
              <button className="ghost-btn" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="danger-btn" onClick={() => { onDelete(confirmDelete); setConfirmDelete(null); }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================== Customer Ledger ============================== */

function CustomerLedger({ invoices, customers, payments, creditNotes, debitNotes, companyById, onView, onRecord }) {
  const names = useMemo(() => {
    const set = new Map();
    invoices.forEach((inv) => {
      const n = inv.customerSnapshot?.name || "Unknown";
      if (!set.has(n)) set.set(n, true);
    });
    customers.forEach((c) => { if (!set.has(c.name)) set.set(c.name, true); });
    return Array.from(set.keys()).sort();
  }, [invoices, customers]);

  const [selected, setSelected] = useState(names[0] || "");
  useEffect(() => { if (!selected && names.length) setSelected(names[0]); }, [names]);

  const rows = invoices.filter((i) => isBillable(i) && (i.customerSnapshot?.name || "Unknown") === selected)
    .sort((a, b) => (a.invoiceDate < b.invoiceDate ? 1 : -1));

  let totalBilled = 0, totalPaid = 0, totalDue = 0, overdue = 0;
  const computed = rows.map((inv) => {
    const company = companyById(inv.companyId);
    const { grandTotal } = computeInvoice(inv, company, inv.customerSnapshot);
    const balance = invoiceBalance(inv, payments, creditNotes, debitNotes, company);
    totalBilled += grandTotal;
    totalPaid += balance.paymentPaise / 100;
    totalDue += balance.outstandingPaise / 100;
    if (effectiveStatus(inv, balance.outstandingPaise) === "overdue") overdue += balance.outstandingPaise / 100;
    return { inv, company, grandTotal, balance };
  });
  const transactions = computed.flatMap(({ inv, company, grandTotal }) => [
    { id: `invoice-${inv.id}`, date: inv.invoiceDate, type: "Invoice", debit: grandTotal, credit: 0, inv, company },
    ...payments.filter((p) => p.invoiceId === inv.id && p.status !== "void").map((p) => ({ id: p.id, date: p.paymentDate, type: "Payment", debit: 0, credit: p.amountPaise / 100, inv, payment: p })),
  ]).sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.id.localeCompare(b.id));
  let runningBalance = 0;

  return (
    <div className="page">
      <div className="page-head"><div><h1>Customer Ledger</h1><p className="muted">Statement of all invoices for a single customer.</p></div></div>

      <div className="card">
        <Field label="Customer">
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            {names.length === 0 && <option value="">No customers yet</option>}
            {names.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
      </div>

      {selected && (
        <>
          <div className="stat-grid">
            <div className="stat-card"><span className="stat-label">Total billed</span><span className="stat-value">₹{fmt(totalBilled)}</span></div>
            <div className="stat-card"><span className="stat-label">Paid</span><span className="stat-value" style={{ color: "var(--green)" }}>₹{fmt(totalPaid)}</span></div>
            <div className="stat-card"><span className="stat-label">Outstanding</span><span className="stat-value warn">₹{fmt(totalDue)}</span></div>
            <div className="stat-card"><span className="stat-label">Invoices</span><span className="stat-value">{rows.length}</span></div>
            <div className="stat-card"><span className="stat-label">Overdue</span><span className="stat-value warn">₹{fmt(overdue)}</span></div>
          </div>

          <div className="card">
            {computed.length === 0 ? <p className="muted">No invoices for this customer yet.</p> : (
              <table className="table">
                <thead><tr><th>Invoice</th><th>Company</th><th>Date</th><th>Amount</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {computed.map(({ inv, company, grandTotal }) => (
                    <tr key={inv.id}>
                      <td>{inv.invoiceNo}</td><td>{company?.name || "—"}</td><td>{dispDate(inv.invoiceDate)}</td>
                      <td>₹{fmt(grandTotal)}</td><td><Badge invoice={inv} /></td>
                      <td><button className="link-btn" onClick={() => onView(inv.id)}>View</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="card">
            <h3>Transaction statement</h3>
            <table className="table"><thead><tr><th>Date</th><th>Transaction</th><th>Invoice</th><th>Debit</th><th>Credit</th><th>Balance</th><th></th></tr></thead><tbody>
              {transactions.map((row) => { runningBalance += row.debit - row.credit; return <tr key={row.id}><td>{dispDate(row.date)}</td><td>{row.type}</td><td>{row.inv.invoiceNo}</td><td>{row.debit ? `₹${fmt(row.debit)}` : "—"}</td><td>{row.credit ? `₹${fmt(row.credit)}` : "—"}</td><td>₹{fmt(runningBalance)}</td><td>{row.type === "Invoice" ? <><button className="link-btn" onClick={() => onView(row.inv.id)}>View</button><button className="link-btn" onClick={async () => { const amount = window.prompt(`Record payment for ${row.inv.invoiceNo}`); if (amount) try { await onRecord({ invoiceId: row.inv.id, amount }); } catch (e) { window.alert(e.message); } }}>Record payment</button></> : <span className="muted small">{row.payment?.referenceNumber || "—"}</span>}</td></tr>; })}
            </tbody></table>
          </div>
        </>
      )}
    </div>
  );
}

/* ============================== Recurring templates ============================== */

function Payments({ invoices, payments, creditNotes, debitNotes, companyById, onRecord, onView }) {
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [error, setError] = useState("");
  const openInvoices = invoices.filter((i) => isBillable(i) && invoiceBalance(i, payments, creditNotes, debitNotes, companyById(i.companyId)).outstandingPaise > 0);
  const submit = async () => {
    try { setError(""); await onRecord({ invoiceId, amount, paymentMethod, referenceNumber, paymentDate: todayISO() }); setInvoiceId(""); setAmount(""); setReferenceNumber(""); }
    catch (e) { setError(e.message || "Unable to record payment."); }
  };
  return <div className="page"><div className="page-head"><div><h1>Payments</h1><p className="muted">Payments are immutable financial transactions; use a reversal/correction workflow in the backend, never a silent edit.</p></div></div>
    <div className="card"><h3>Record payment</h3>{error && <div className="error-banner">{error}</div>}<div className="two-col"><Field label="Invoice"><select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}><option value="">Select an outstanding invoice…</option>{openInvoices.map((i) => { const b = invoiceBalance(i, payments, creditNotes, debitNotes, companyById(i.companyId)); return <option key={i.id} value={i.id}>{i.invoiceNo} — {i.customerSnapshot?.name} (₹{fmt(b.outstandingPaise / 100)} due)</option>; })}</select></Field><Field label="Amount"><input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field><Field label="Method"><select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}><option value="bank_transfer">Bank transfer</option><option value="upi">UPI</option><option value="cash">Cash</option><option value="cheque">Cheque</option></select></Field><Field label="Reference / UTR"><input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} /></Field></div><button className="primary-btn" disabled={!invoiceId || !amount} onClick={submit}>Record payment</button></div>
    <div className="card"><h3>Recent payments</h3>{payments.length === 0 ? <p className="muted">No payments recorded.</p> : <table className="table"><thead><tr><th>Date</th><th>Invoice</th><th>Customer</th><th>Method</th><th>Reference</th><th>Amount</th></tr></thead><tbody>{payments.map((p) => { const inv = invoices.find((i) => i.id === p.invoiceId); return <tr key={p.id}><td>{dispDate(p.paymentDate)}</td><td><button className="link-btn" onClick={() => inv && onView(inv.id)}>{inv?.invoiceNo || "Deleted invoice"}</button></td><td>{inv?.customerSnapshot?.name || "—"}</td><td>{p.paymentMethod}</td><td>{p.referenceNumber || "—"}</td><td>₹{fmt(p.amountPaise / 100)}</td></tr>; })}</tbody></table>}</div>
  </div>;
}

function Recurring({ templates, companies, customers, persistTemplates, notify, onGenerate }) {
  const [editing, setEditing] = useState(null);
  const remove = async (id) => { await persistTemplates(templates.filter((t) => t.id !== id)); notify("Template removed"); };

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Recurring Bills</h1><p className="muted">Templates for customers you bill every month — generate next month's invoice in one click.</p></div>
      </div>

      <div className="card-grid">
        {templates.length === 0 && (
          <p className="muted">No templates yet. Tick "Save as a recurring template" while creating an invoice to add one.</p>
        )}
        {templates.map((t) => {
          const company = companies.find((c) => c.id === t.companyId);
          return (
            <div className="card entity-card" key={t.id}>
              <div className="entity-title">{t.customerSnapshot?.name}</div>
              <div className="muted small">Billed by {company?.name || "—"}</div>
              <div className="muted small">{t.items.length} line item{t.items.length === 1 ? "" : "s"}</div>
              <div className="row-gap">
                <button className="primary-btn small" onClick={() => onGenerate(t)}>Generate invoice</button>
                <button className="ghost-btn small danger" onClick={() => remove(t.id)}>Remove</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================== Reports ============================== */

function Reports({ invoices, companies, companyById }) {
  const billableInvoices = useMemo(() => invoices.filter(isBillable), [invoices]);

  const byCompany = useMemo(() => {
    const map = {};
    billableInvoices.forEach((inv) => {
      const company = companyById(inv.companyId);
      const t = computeInvoice(inv, company, inv.customerSnapshot);
      const key = company?.name || "Unassigned";
      if (!map[key]) map[key] = { taxable: 0, tax: 0, total: 0, count: 0 };
      map[key].taxable += t.taxable; map[key].tax += t.totalTax; map[key].total += t.grandTotal; map[key].count++;
    });
    return map;
  }, [billableInvoices, companyById]);

  const byRate = useMemo(() => {
    const map = {};
    billableInvoices.forEach((inv) => {
      const company = companyById(inv.companyId);
      const t = computeInvoice(inv, company, inv.customerSnapshot);
      t.hsnRows.forEach((r) => {
        const key = r.rate + "%";
        if (!map[key]) map[key] = { taxable: 0, tax: 0 };
        map[key].taxable += r.taxable; map[key].tax += r.total;
      });
    });
    return map;
  }, [billableInvoices, companyById]);

  const exportCSV = () => {
    const header = ["Invoice No", "Date", "Company", "Customer", "Taxable", "CGST", "SGST", "IGST", "Total Tax", "Grand Total", "Status"];
    const csvField = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = billableInvoices.map((inv) => {
      const company = companyById(inv.companyId);
      const t = computeInvoice(inv, company, inv.customerSnapshot);
      return [
        inv.invoiceNo, inv.invoiceDate, company?.name || "", inv.customerSnapshot?.name || "",
        t.taxable.toFixed(2), t.cgstTotal.toFixed(2), t.sgstTotal.toFixed(2), t.igstTotal.toFixed(2),
        t.totalTax.toFixed(2), t.grandTotal.toFixed(2), STATUS_META[effectiveStatus(inv)]?.label || inv.status,
      ].map(csvField).join(",");
    });
    const csv = [header.map(csvField).join(","), ...lines].join("\n");
    const data = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    const a = document.createElement("a"); a.href = data; a.download = "invoices-report.csv"; a.click();
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Reports</h1><p className="muted">GST summary across all your companies · internal preparation report, not a GST-portal filing.</p></div>
        <button className="ghost-btn" onClick={exportCSV} disabled={invoices.length === 0}>Export CSV</button>
      </div>

      <div className="card">
        <h3>By company</h3>
        {Object.keys(byCompany).length === 0 ? <p className="muted">No data yet.</p> : (
          <table className="table">
            <thead><tr><th>Company</th><th>Invoices</th><th>Taxable</th><th>Tax</th><th>Total</th></tr></thead>
            <tbody>
              {Object.entries(byCompany).map(([name, v]) => (
                <tr key={name}><td>{name}</td><td>{v.count}</td><td>₹{fmt(v.taxable)}</td><td>₹{fmt(v.tax)}</td><td>₹{fmt(v.total)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>By tax rate</h3>
        {Object.keys(byRate).length === 0 ? <p className="muted">No data yet.</p> : (
          <table className="table">
            <thead><tr><th>Rate</th><th>Taxable value</th><th>Tax collected</th></tr></thead>
            <tbody>
              {Object.entries(byRate).map(([rate, v]) => (
                <tr key={rate}><td>{rate}</td><td>₹{fmt(v.taxable)}</td><td>₹{fmt(v.tax)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ============================== Company Tracker ============================== */

function daysBetween(iso) {
  if (!iso) return 0;
  const then = new Date(iso + "T00:00:00");
  const now = new Date(todayISO() + "T00:00:00");
  return Math.max(0, Math.round((now - then) / 86400000));
}

function agingBucket(days) {
  if (days <= 30) return "0-30 days";
  if (days <= 60) return "31-60 days";
  if (days <= 90) return "61-90 days";
  return "90+ days";
}

function CompanyTracker({ invoices, companies, companyById, onView }) {
  const [openId, setOpenId] = useState(null);

  const byCompany = useMemo(() => {
    const map = {};
    companies.forEach((c) => {
      map[c.id] = {
        company: c, invoiceCount: 0, billed: 0, paid: 0, outstanding: 0,
        paidCount: 0, unpaidCount: 0, byCustomer: {}, aging: { "0-30 days": 0, "31-60 days": 0, "61-90 days": 0, "90+ days": 0 },
        oldestUnpaid: null,
      };
    });
    invoices.filter(isBillable).forEach((inv) => {
      const bucket = map[inv.companyId];
      if (!bucket) return;
      const company = companyById(inv.companyId);
      const { grandTotal } = computeInvoice(inv, company, inv.customerSnapshot);
      bucket.invoiceCount++;
      bucket.billed += grandTotal;
      if (inv.status === "paid") {
        bucket.paid += grandTotal; bucket.paidCount++;
      } else {
        bucket.outstanding += grandTotal; bucket.unpaidCount++;
        const custName = inv.customerSnapshot?.name || "Unknown";
        if (!bucket.byCustomer[custName]) bucket.byCustomer[custName] = { amount: 0, count: 0, oldest: inv.invoiceDate };
        bucket.byCustomer[custName].amount += grandTotal;
        bucket.byCustomer[custName].count++;
        if (inv.invoiceDate < bucket.byCustomer[custName].oldest) bucket.byCustomer[custName].oldest = inv.invoiceDate;
        const days = daysBetween(inv.invoiceDate);
        bucket.aging[agingBucket(days)] += grandTotal;
        if (!bucket.oldestUnpaid || inv.invoiceDate < bucket.oldestUnpaid.invoiceDate) bucket.oldestUnpaid = inv;
      }
    });
    return Object.values(map).sort((a, b) => b.outstanding - a.outstanding);
  }, [invoices, companies, companyById]);

  const grandOutstanding = byCompany.reduce((s, b) => s + b.outstanding, 0);
  const grandBilled = byCompany.reduce((s, b) => s + b.billed, 0);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Company Tracking</h1><p className="muted">Outstanding balance, aging and top debtors for each of your companies.</p></div>
      </div>

      <div className="stat-grid">
        <div className="stat-card"><span className="stat-label">Total billed (all companies)</span><span className="stat-value">₹{fmt(grandBilled)}</span></div>
        <div className="stat-card"><span className="stat-label">Total outstanding</span><span className="stat-value warn">₹{fmt(grandOutstanding)}</span></div>
        <div className="stat-card"><span className="stat-label">Companies</span><span className="stat-value">{companies.length}</span></div>
      </div>

      {byCompany.length === 0 && <p className="muted">Add a company to start tracking.</p>}

      <div className="card-grid" style={{ gridTemplateColumns: "1fr" }}>
        {byCompany.map((b) => {
          const isOpen = openId === b.company.id;
          const debtors = Object.entries(b.byCustomer).sort((a, z) => z[1].amount - a[1].amount);
          const oldestDays = b.oldestUnpaid ? daysBetween(b.oldestUnpaid.invoiceDate) : 0;
          return (
            <div className="card" key={b.company.id}>
              <div className="row-gap" style={{ justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                onClick={() => setOpenId(isOpen ? null : b.company.id)}>
                <div className="row-gap" style={{ alignItems: "center", gap: 12 }}>
                  <Logo style={b.company.logoStyle} color={b.company.logoColor} size={32} />
                  <div>
                    <div className="entity-title">{b.company.name || "Untitled company"}</div>
                    <div className="muted small">{b.invoiceCount} invoice{b.invoiceCount === 1 ? "" : "s"} · {b.paidCount} paid · {b.unpaidCount} unpaid</div>
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="stat-value warn" style={{ fontSize: 20 }}>₹{fmt(b.outstanding)}</div>
                  <div className="muted small">outstanding</div>
                </div>
              </div>

              {isOpen && (
                <div style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
                  <div className="stat-grid">
                    <div className="stat-card"><span className="stat-label">Billed</span><span className="stat-value">₹{fmt(b.billed)}</span></div>
                    <div className="stat-card"><span className="stat-label">Paid</span><span className="stat-value" style={{ color: "var(--green)" }}>₹{fmt(b.paid)}</span></div>
                    <div className="stat-card"><span className="stat-label">Outstanding</span><span className="stat-value warn">₹{fmt(b.outstanding)}</span></div>
                    <div className="stat-card"><span className="stat-label">Oldest unpaid</span><span className="stat-value">{b.oldestUnpaid ? `${oldestDays}d` : "—"}</span></div>
                  </div>

                  {b.unpaidCount > 0 && (
                    <>
                      <h3 style={{ marginTop: 18 }}>Aging of outstanding balance</h3>
                      <table className="table">
                        <thead><tr><th>0-30 days</th><th>31-60 days</th><th>61-90 days</th><th>90+ days</th></tr></thead>
                        <tbody>
                          <tr>
                            <td>₹{fmt(b.aging["0-30 days"])}</td>
                            <td className={b.aging["31-60 days"] > 0 ? "warn" : ""}>₹{fmt(b.aging["31-60 days"])}</td>
                            <td className={b.aging["61-90 days"] > 0 ? "warn" : ""}>₹{fmt(b.aging["61-90 days"])}</td>
                            <td className={b.aging["90+ days"] > 0 ? "warn" : ""}>₹{fmt(b.aging["90+ days"])}</td>
                          </tr>
                        </tbody>
                      </table>

                      <h3 style={{ marginTop: 18 }}>Outstanding by customer</h3>
                      <table className="table">
                        <thead><tr><th>Customer</th><th>Unpaid invoices</th><th>Since</th><th>Amount due</th></tr></thead>
                        <tbody>
                          {debtors.map(([name, d]) => (
                            <tr key={name}>
                              <td>{name}</td><td>{d.count}</td><td>{dispDate(d.oldest)}</td>
                              <td className="warn">₹{fmt(d.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}

                  <h3 style={{ marginTop: 18 }}>Company details</h3>
                  <div className="detail-grid">
                    <div><span className="muted small">GSTIN</span><div>{b.company.gstin || "—"}</div></div>
                    <div><span className="muted small">PAN</span><div>{b.company.pan || "—"}</div></div>
                    <div><span className="muted small">Mobile</span><div>{b.company.mobile || "—"}</div></div>
                    <div><span className="muted small">Bank</span><div>{b.company.bankName || "—"} {b.company.accountNo ? `· ${b.company.accountNo}` : ""}</div></div>
                  </div>

                  {b.oldestUnpaid && (
                    <div className="row-gap" style={{ marginTop: 14 }}>
                      <button className="link-btn" onClick={() => onView(b.oldestUnpaid.id)}>View oldest unpaid invoice</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================== Company Manager ============================== */

function emptyCompany() {
  return {
    id: uid(), name: "", gstin: "", pan: "", address: "", mobile: "", email: "", website: "-",
    bankName: "", accountNo: "", ifsc: "", branch: "", invoicePrefix: "INV-",
    invoiceStartNumber: 1, numberPadding: 3, fyResetEnabled: false,
    logoStyle: "custom", logoColor: "#C6332B",
  };
}

function CompanyManager({ companies, invoices, onSave, notify }) {
  const [editing, setEditing] = useState(null);
  const upsert = async (c) => {
    const exists = companies.some((x) => x.id === c.id);
    const next = exists ? companies.map((x) => (x.id === c.id ? c : x)) : [...companies, c];
    await onSave(next); setEditing(null); notify("Company saved");
  };
  const remove = async (id) => {
    if (invoices.some((i) => i.companyId === id)) { await onSave(companies.map((c) => c.id === id ? { ...c, active: false } : c)); notify("Company has financial history and was archived instead."); return; }
    await onSave(companies.filter((c) => c.id !== id)); notify("Company removed");
  };

  return (
    <div className="page">
      <div className="page-head"><div><h1>My Companies</h1><p className="muted">Businesses you issue invoices from.</p></div>
        <button className="primary-btn" onClick={() => setEditing(emptyCompany())}>+ Add company</button>
      </div>
      <div className="card-grid">
        {companies.map((c) => (
          <div className="card entity-card" key={c.id}>
            <div className="entity-head">
              <Logo style={c.logoStyle} color={c.logoColor} size={30} />
              <div><div className="entity-title">{c.name}</div><div className="muted small">{c.gstin}</div></div>
            </div>
            <p className="muted small">{c.address}</p>
            <div className="row-gap">
              <button className="ghost-btn small" onClick={() => setEditing(c)}>Edit</button>
              <button className="ghost-btn small danger" onClick={() => remove(c.id)}>Remove</button>
            </div>
          </div>
        ))}
      </div>
      {editing && <CompanyEditModal company={editing} onCancel={() => setEditing(null)} onSave={upsert} />}
    </div>
  );
}

function CompanyEditModal({ company, onCancel, onSave }) {
  const [c, setC] = useState({ invoiceStartNumber: 1, numberPadding: 3, fyResetEnabled: false, ...company });
  const p = (patch) => setC({ ...c, ...patch });
  const gstinCheck = validateGSTIN(c.gstin);
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{company.name ? "Edit company" : "New company"}</h3>
        <Field label="Company name"><input value={c.name} onChange={(e) => p({ name: e.target.value })} /></Field>
        <div className="two-col">
          <Field label="GSTIN"><input value={c.gstin} onChange={(e) => p({ gstin: e.target.value.toUpperCase() })} /></Field>
          <Field label="PAN"><input value={c.pan} onChange={(e) => p({ pan: e.target.value.toUpperCase() })} /></Field>
        </div>
        {c.gstin && !gstinCheck.valid && <p className="muted small" style={{ color: "var(--red)", marginTop: -8 }}>⚠ {gstinCheck.reason}</p>}
        {c.gstin && gstinCheck.valid && <p className="muted small" style={{ marginTop: -8 }}>✓ Valid GSTIN format · {gstinCheck.state}</p>}
        <Field label="Address"><textarea rows={2} value={c.address} onChange={(e) => p({ address: e.target.value })} /></Field>
        <div className="two-col">
          <Field label="Mobile"><input value={c.mobile} onChange={(e) => p({ mobile: e.target.value })} /></Field>
          <Field label="Email"><input value={c.email} onChange={(e) => p({ email: e.target.value })} /></Field>
        </div>
        <div className="two-col">
          <Field label="Bank name"><input value={c.bankName} onChange={(e) => p({ bankName: e.target.value })} /></Field>
          <Field label="Account no."><input value={c.accountNo} onChange={(e) => p({ accountNo: e.target.value })} /></Field>
        </div>
        <div className="two-col">
          <Field label="IFSC"><input value={c.ifsc} onChange={(e) => p({ ifsc: e.target.value.toUpperCase() })} /></Field>
          <Field label="Branch"><input value={c.branch} onChange={(e) => p({ branch: e.target.value })} /></Field>
        </div>

        <h3 style={{ marginTop: 6 }}>Invoice numbering</h3>
        <div className="two-col">
          <Field label="Invoice number prefix" hint="e.g. SRE 2026/27-"><input value={c.invoicePrefix} onChange={(e) => p({ invoicePrefix: e.target.value })} /></Field>
          <Field label="Starting number"><input type="number" min={1} value={c.invoiceStartNumber} onChange={(e) => p({ invoiceStartNumber: parseInt(e.target.value, 10) || 1 })} /></Field>
        </div>
        <div className="two-col">
          <Field label="Number padding" hint="e.g. 3 → 001"><input type="number" min={1} max={8} value={c.numberPadding} onChange={(e) => p({ numberPadding: parseInt(e.target.value, 10) || 3 })} /></Field>
          <Field label="Preview"><input value={(c.invoicePrefix || "") + String(c.invoiceStartNumber || 1).padStart(c.numberPadding || 3, "0")} disabled /></Field>
        </div>
        <label className="checkbox-row">
          <input type="checkbox" checked={!!c.fyResetEnabled} onChange={(e) => p({ fyResetEnabled: e.target.checked })} />
          Restart numbering at the start of each financial year (Apr–Mar)
        </label>

        <div className="two-col">
          <Field label="Logo" hint={c.logoStyle !== "custom" ? "Locked to the original letterhead mark for this company." : "Colorable placeholder mark — swap in an uploaded logo later if you have one."}>
            <select value={c.logoStyle} onChange={(e) => p({ logoStyle: e.target.value })}>
              <option value="sagar">Sagar Roadways mark (red/grey)</option>
              <option value="ssk">S S K Roadlines mark (orange/grey)</option>
              <option value="custom">Custom colorable mark</option>
            </select>
          </Field>
          {c.logoStyle === "custom" && (
            <Field label="Logo accent color"><input type="color" value={c.logoColor} onChange={(e) => p({ logoColor: e.target.value })} /></Field>
          )}
        </div>
        <div className="row-gap" style={{ marginBottom: 12 }}><Logo style={c.logoStyle} color={c.logoColor} size={40} /></div>
        <div className="row-gap end">
          <button className="ghost-btn" onClick={onCancel}>Cancel</button>
          <button className="primary-btn" onClick={() => onSave(c)} disabled={!c.name}>Save</button>
        </div>
      </div>
    </div>
  );
}

/* ============================== Customer Manager ============================== */

function emptyCustomer() { return { id: uid(), name: "", phone: "", gstin: "", billingAddress: "", shippingAddress: "", state: "" }; }

function CustomerManager({ customers, invoices, onSave, notify }) {
  const [editing, setEditing] = useState(null);
  const upsert = async (c) => {
    const exists = customers.some((x) => x.id === c.id);
    const next = exists ? customers.map((x) => (x.id === c.id ? c : x)) : [...customers, c];
    await onSave(next); setEditing(null); notify("Customer saved");
  };
  const remove = async (id) => {
    if (invoices.some((i) => i.customerId === id)) { await onSave(customers.map((c) => c.id === id ? { ...c, active: false } : c)); notify("Customer has financial history and was archived instead."); return; }
    await onSave(customers.filter((c) => c.id !== id)); notify("Customer removed");
  };

  return (
    <div className="page">
      <div className="page-head"><div><h1>Customers</h1><p className="muted">Saved billing parties for faster invoicing.</p></div>
        <button className="primary-btn" onClick={() => setEditing(emptyCustomer())}>+ Add customer</button>
      </div>
      <div className="card-grid">
        {customers.length === 0 && <p className="muted">No saved customers yet — they'll also save automatically from the invoice form.</p>}
        {customers.map((c) => (
          <div className="card entity-card" key={c.id}>
            <div className="entity-title">{c.name}</div>
            <div className="muted small">{c.gstin} {c.gstin && `· ${stateFromGSTIN(c.gstin)}`}</div>
            <p className="muted small">{c.billingAddress}</p>
            <div className="row-gap">
              <button className="ghost-btn small" onClick={() => setEditing(c)}>Edit</button>
              <button className="ghost-btn small danger" onClick={() => remove(c.id)}>Remove</button>
            </div>
          </div>
        ))}
      </div>
      {editing && <CustomerEditModal customer={editing} onCancel={() => setEditing(null)} onSave={upsert} />}
    </div>
  );
}

function CustomerEditModal({ customer, onCancel, onSave }) {
  const [c, setC] = useState(customer);
  const p = (patch) => setC({ ...c, ...patch });
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{customer.name ? "Edit customer" : "New customer"}</h3>
        <Field label="Name"><input value={c.name} onChange={(e) => p({ name: e.target.value })} /></Field>
        <div className="two-col">
          <Field label="Phone"><input value={c.phone} onChange={(e) => p({ phone: e.target.value })} /></Field>
          <Field label="GSTIN"><input value={c.gstin} onChange={(e) => p({ gstin: e.target.value.toUpperCase(), state: stateFromGSTIN(e.target.value) })} /></Field>
        </div>
        <Field label="Billing address"><textarea rows={2} value={c.billingAddress} onChange={(e) => p({ billingAddress: e.target.value })} /></Field>
        <Field label="Shipping address (optional)"><textarea rows={2} value={c.shippingAddress} onChange={(e) => p({ shippingAddress: e.target.value })} /></Field>
        <div className="row-gap end">
          <button className="ghost-btn" onClick={onCancel}>Cancel</button>
          <button className="primary-btn" onClick={() => onSave(c)} disabled={!c.name}>Save</button>
        </div>
      </div>
    </div>
  );
}

/* ============================== Products ============================== */

function emptyProduct(companyId) { return { id: uid(), companyId: companyId || "", name: "", description: "", hsn: "", unit: "Nos", rate: 0, taxRate: 18 }; }

function ProductManager({ products, companies, onSave, notify }) {
  const [editing, setEditing] = useState(null);
  const companyById = (id) => companies.find((c) => c.id === id);

  const upsert = async (p) => {
    const exists = products.some((x) => x.id === p.id);
    const next = exists ? products.map((x) => (x.id === p.id ? p : x)) : [...products, p];
    await onSave(next); setEditing(null); notify("Product saved");
  };
  const remove = async (id) => { await onSave(products.filter((p) => p.id !== id)); notify("Product removed"); };

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Products</h1><p className="muted">Your catalog — pick these while building an invoice to auto-fill rate, HSN/SAC and GST rate.</p></div>
        <button className="primary-btn" onClick={() => setEditing(emptyProduct(companies[0]?.id))} disabled={!companies.length}>+ Add product</button>
      </div>
      {!companies.length && <p className="muted">Add a company first — products belong to a company.</p>}
      <div className="card-grid">
        {products.length === 0 && companies.length > 0 && <p className="muted">No products yet. Add your frequently billed items/services here.</p>}
        {products.map((p) => (
          <div className="card entity-card" key={p.id}>
            <div className="entity-title">{p.name}</div>
            <div className="muted small">{companyById(p.companyId)?.name || "—"} · HSN/SAC {p.hsn || "—"}</div>
            <p className="muted small">₹{fmt(p.rate)} / {p.unit} · GST {p.taxRate}%</p>
            <div className="row-gap">
              <button className="ghost-btn small" onClick={() => setEditing(p)}>Edit</button>
              <button className="ghost-btn small danger" onClick={() => remove(p.id)}>Remove</button>
            </div>
          </div>
        ))}
      </div>
      {editing && <ProductEditModal product={editing} companies={companies} onCancel={() => setEditing(null)} onSave={upsert} />}
    </div>
  );
}

function ProductEditModal({ product, companies, onCancel, onSave }) {
  const [p, setP] = useState(product);
  const patch = (x) => setP({ ...p, ...x });
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{product.name ? "Edit product" : "New product"}</h3>
        <Field label="Company">
          <select value={p.companyId} onChange={(e) => patch({ companyId: e.target.value })}>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Name / description"><input value={p.name} onChange={(e) => patch({ name: e.target.value })} /></Field>
        <div className="two-col">
          <Field label="HSN/SAC"><input value={p.hsn} onChange={(e) => patch({ hsn: e.target.value })} /></Field>
          <Field label="Unit"><input value={p.unit} onChange={(e) => patch({ unit: e.target.value })} /></Field>
        </div>
        <div className="two-col">
          <Field label="Rate (₹)"><input type="number" min="0" step="0.01" value={p.rate} onChange={(e) => patch({ rate: e.target.value })} /></Field>
          <Field label="GST rate (%)"><input type="number" min="0" max="100" step="0.01" value={p.taxRate} onChange={(e) => patch({ taxRate: e.target.value })} /></Field>
        </div>
        <div className="row-gap end">
          <button className="ghost-btn" onClick={onCancel}>Cancel</button>
          <button className="primary-btn" onClick={() => onSave({ ...p, rate: Number(p.rate) || 0, taxRate: Number(p.taxRate) || 0 })} disabled={!p.name || !p.companyId}>Save</button>
        </div>
      </div>
    </div>
  );
}

/* ============================== Preview / Print ============================== */

function PreviewModal({ invoice, company, onClose }) {
  const totals = computeInvoice(invoice, company, invoice.customerSnapshot);
  const cust = invoice.customerSnapshot;
  const colSpan = totals.interstate ? 2 : 4;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal preview-modal" onClick={(e) => e.stopPropagation()}>
        <div className="preview-toolbar no-print">
          <span>Invoice preview</span>
          <div className="row-gap">
            <button className="ghost-btn small" onClick={() => window.print()}>Print / Save PDF</button>
            <button className="ghost-btn small" onClick={onClose}>Close</button>
          </div>
        </div>

        <div id="print-area" className="invoice-sheet">
          <div className="inv-topline">
            <span className="inv-kicker-center">TAX INVOICE</span>
            <span className="inv-kicker-right">ORIGINAL FOR RECIPIENT</span>
          </div>

          <div className="inv-frame">
            <div className="inv-company-block">
              <div className="inv-logo-float"><Logo style={company?.logoStyle} color={company?.logoColor} size={52} /></div>
              <div className="inv-company-name">{company?.name}</div>
              <div className="inv-company-sub bold-inline">GSTIN {company?.gstin} &nbsp;&nbsp; PAN {company?.pan}</div>
              <div className="inv-company-sub">{company?.address}</div>
              <div className="inv-company-sub"><span className="bold-inline">Mobile</span> {company?.mobile} &nbsp; <span className="bold-inline">Email</span> {company?.email}</div>
              <div className="inv-company-sub">Website {company?.website || "-"}</div>
            </div>

            <div className="inv-parties">
              <div className="inv-box">
                <div className="inv-box-title">Customer Details:</div>
                <div className="bold">{cust.name}</div>
                {cust.phone && <div>Ph: {cust.phone}</div>}
                {cust.gstin && <div>GSTIN: {cust.gstin}</div>}
                <div className="inv-box-title mt">Billing address:</div>
                <div className="pre">{cust.billingAddress}</div>
              </div>
              <div className="inv-box">
                <div className="inv-meta-row"><span className="inv-box-title">Invoice No:</span><span className="bold">{invoice.invoiceNo}</span></div>
                <div className="inv-meta-row"><span className="inv-box-title">Invoice Date:</span><span className="bold">{dispDate(invoice.invoiceDate)}</span></div>
                <div className="inv-box-title mt">Shipping Address:</div>
                <div className="pre">{cust.sameAsBilling ? cust.billingAddress : cust.shippingAddress}</div>
              </div>
            </div>

            <table className="inv-items-table">
              <thead><tr><th style={{ width: 28 }}>#</th><th>Item</th><th>HSN/SAC</th><th>Tax</th><th>Qty</th><th>Rate/Item</th><th>Amount</th></tr></thead>
              <tbody>
                {totals.items.map((it, idx) => (
                  <tr key={it.id}>
                    <td>{idx + 1}</td>
                    <td className="pre">{it.description}</td>
                    <td>{it.hsn}</td>
                    <td>{it.taxRate}%</td>
                    <td>{it.qty} Nos</td>
                    <td className="num">{fmt(fromPaise(toPaise(it.rate)))}</td>
                    <td className="num">{fmt(it.amount)}</td>
                  </tr>
                ))}
                <tr className="subtotal-row"><td colSpan={6} className="right">Taxable Amount</td><td className="num">{fmt(totals.taxable)}</td></tr>
                {totals.interstate ? (
                  <tr><td colSpan={6} className="right">IGST</td><td className="num">{fmt(totals.totalTax)}</td></tr>
                ) : (
                  <>
                    <tr><td colSpan={6} className="right">CGST</td><td className="num">{fmt(totals.cgstTotal)}</td></tr>
                    <tr><td colSpan={6} className="right">SGST</td><td className="num">{fmt(totals.sgstTotal)}</td></tr>
                  </>
                )}
                {Math.abs(totals.roundOff) > 0.001 && <tr><td colSpan={6} className="right">Round Off</td><td className="num">{totals.roundOff >= 0 ? "+" : ""}{fmt(totals.roundOff)}</td></tr>}
                <tr className="total-row"><td colSpan={6} className="right">Total</td><td className="num">₹ {fmt(totals.grandTotal)}</td></tr>
              </tbody>
            </table>

            <div className="inv-words">Amount Chargeable (in words): {amountInWords(totals.grandTotal)} <span className="italic right-float">E &amp; O.E</span></div>

            <table className="inv-hsn-table">
              <thead>
                <tr>
                  <th rowSpan={2}>HSN/SAC</th><th rowSpan={2}>Taxable Value</th>
                  <th colSpan={colSpan}>{totals.interstate ? "Integrated Tax" : "Central Tax / State Tax"}</th>
                  <th rowSpan={2}>Total Tax Amount</th>
                </tr>
                <tr>
                  {totals.interstate ? (<><th>Rate</th><th>Amount</th></>) : (<><th>CGST Rate</th><th>CGST Amt</th><th>SGST Rate</th><th>SGST Amt</th></>)}
                </tr>
              </thead>
              <tbody>
                {totals.hsnRows.map((r) => (
                  <tr key={r.hsn + r.rate}>
                    <td>{r.hsn}</td>
                    <td className="num">{fmt(r.taxable)}</td>
                    {totals.interstate ? (
                      <><td>{r.rate}%</td><td className="num">{fmt(r.igst)}</td></>
                    ) : (
                      <><td>{r.rate / 2}%</td><td className="num">{fmt(r.cgst)}</td><td>{r.rate / 2}%</td><td className="num">{fmt(r.sgst)}</td></>
                    )}
                    <td className="num">{fmt(r.total)}</td>
                  </tr>
                ))}
                <tr className="total-row">
                  <td>TOTAL</td><td className="num">{fmt(totals.taxable)}</td>
                  {totals.interstate ? (
                    <td colSpan={2}></td>
                  ) : (
                    <><td colSpan={2}></td><td colSpan={2}></td></>
                  )}
                  <td className="num">{fmt(totals.totalTax)}</td>
                </tr>
              </tbody>
            </table>

            <div className="inv-payable">Amount Payable: <span className="bold">₹ {fmt(totals.grandTotal)}</span></div>

            <div className="inv-bottom">
              <div className="inv-box">
                <div className="inv-box-title">Bank Details:</div>
                <div>Bank: <span className="bold-inline">{company?.bankName}</span></div>
                <div>Account no: <span className="bold-inline">{company?.accountNo}</span></div>
                <div>IFSC: <span className="bold-inline">{company?.ifsc}</span></div>
                <div>Branch: <span className="bold-inline">{company?.branch}</span></div>
              </div>
              <div className="inv-box right-align">
                <div>For {company?.name}</div>
                <div className="signatory">Authorized Signatory</div>
              </div>
            </div>
          </div>

          {invoice.notes && <div className="inv-notes"><strong>Notes:</strong> {invoice.notes}</div>}
        </div>
      </div>
    </div>
  );
}

/* ============================== CSS ============================== */

const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Lora:wght@500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap');

:root{
  --paper:#F7F4EC; --surface:#FFFFFF; --line:#E4DFD1; --ink:#22283A; --ink-soft:#6B6455;
  --navy:#1F2A44; --red:#B8433D; --gold:#C89B3C; --green:#2F6B3E;
}
*{box-sizing:border-box;}
.app-shell{display:flex; min-height:100vh; background:var(--paper); color:var(--ink); font-family:'Inter',sans-serif; font-size:14px; position:relative;}
.center-loading{align-items:center; justify-content:center;}
.loader{display:flex; flex-direction:column; align-items:center; gap:10px; color:var(--ink-soft);}
.offline-banner{position:fixed; top:0; left:0; right:0; z-index:60; background:#FEF3C7; color:#92400E; text-align:center; padding:8px 14px; font-size:13px; font-weight:600; border-bottom:1px solid #FDE68A;}

.sidebar{width:230px; flex-shrink:0; background:var(--navy); color:#EFEDE4; display:flex; flex-direction:column; padding:22px 16px; gap:22px;}
.brand{display:flex; align-items:center; gap:10px;}
.brand-title{font-family:'Lora',serif; font-weight:700; font-size:19px; color:#fff;}
.brand-sub{font-size:11px; color:#B9BFD4; letter-spacing:.03em;}
nav{display:flex; flex-direction:column; gap:4px;}
.nav-btn{text-align:left; background:transparent; border:none; color:#D7DAEA; padding:10px 12px; border-radius:8px; font-size:13.5px; cursor:pointer; font-weight:500;}
.nav-btn:hover{background:rgba(255,255,255,.08);}
.nav-btn.active{background:var(--gold); color:#1F2A44; font-weight:700;}
.sidebar-foot{margin-top:auto;}
.menu-toggle{display:none;}

.main-area{flex:1; padding:30px 36px; max-width:1150px; margin:0 auto; width:100%;}
.page{display:flex; flex-direction:column; gap:20px;}
.page-head{display:flex; justify-content:space-between; align-items:flex-end; flex-wrap:wrap; gap:14px;}
.page-head h1{font-family:'Lora',serif; font-size:28px; margin:0 0 4px;}
.muted{color:var(--ink-soft); margin:0;}
.small{font-size:12px;}

.stat-grid{display:grid; grid-template-columns:repeat(4,1fr); gap:14px;}
.stat-grid-6{grid-template-columns:repeat(6,1fr);}
.stat-card{background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:16px 18px; display:flex; flex-direction:column; gap:6px;}
.stat-label{font-size:12px; color:var(--ink-soft); text-transform:uppercase; letter-spacing:.04em;}
.stat-value{font-family:'IBM Plex Mono',monospace; font-size:22px; font-weight:600;}
.stat-value.warn{color:var(--red);}
.warn{color:var(--red); font-weight:600;}
.logo-img-wrap{display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;}
.logo-img-wrap img{height:100%; width:auto; object-fit:contain; display:block;}
.detail-grid{display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:12px 20px; margin-top:8px;}
.detail-grid > div{display:flex; flex-direction:column; gap:2px;}

.dash-grid{display:grid; grid-template-columns:2fr 1fr; gap:20px; align-items:start;}
.dash-col-main{display:flex; flex-direction:column; gap:20px; min-width:0;}
.dash-col-side{display:flex; flex-direction:column; gap:20px; min-width:0;}

.company-bars{display:flex; flex-direction:column; gap:16px;}
.company-bar-name{font-weight:600; font-size:13px;}
.company-bar-track{width:100%; height:8px; background:var(--paper); border:1px solid var(--line); border-radius:5px; overflow:hidden;}
.company-bar-fill{height:100%; background:linear-gradient(90deg,var(--gold),var(--red)); border-radius:5px;}
.company-bar-figures{display:flex; justify-content:space-between; font-size:11.5px; color:var(--ink-soft); margin-top:4px;}

.side-list{list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:10px;}
.side-list li{display:flex; justify-content:space-between; align-items:center; font-size:13px; gap:10px; padding-bottom:10px; border-bottom:1px solid #F0EDE3;}
.side-list li:last-child{border-bottom:none; padding-bottom:0;}
.side-list-click{cursor:pointer;}
.side-list-click:hover span:first-child{text-decoration:underline;}

.card{background:var(--surface); border:1px solid var(--line); border-radius:14px; padding:20px 22px;}
.card h3{margin:0 0 12px; font-family:'Lora',serif; font-size:17px;}
.card-head-row{display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;}
.card-grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:14px;}

.bar-chart{display:flex; gap:18px; align-items:flex-end; height:150px; padding-top:10px;}
.bar-col{display:flex; flex-direction:column; align-items:center; gap:6px; flex:1; height:100%; justify-content:flex-end;}
.bar-track{width:28px; height:100px; background:var(--paper); border-radius:6px; display:flex; align-items:flex-end; overflow:hidden; border:1px solid var(--line);}
.bar-fill{width:100%; background:linear-gradient(180deg,var(--gold),var(--red)); border-radius:6px 6px 0 0;}
.bar-amt{font-family:'IBM Plex Mono',monospace; font-size:11px; color:var(--ink-soft);}
.bar-label{font-size:10px; color:var(--ink-soft);}

.table{width:100%; border-collapse:collapse; font-size:13px;}
.table th{text-align:left; color:var(--ink-soft); font-weight:600; font-size:11.5px; text-transform:uppercase; letter-spacing:.03em; border-bottom:1px solid var(--line); padding:8px 6px;}
.table td{padding:9px 6px; border-bottom:1px solid #F0EDE3;}
.row-actions{display:flex; gap:10px; white-space:nowrap;}

.link-btn{background:none; border:none; color:var(--navy); font-weight:600; cursor:pointer; padding:0; font-size:13px;}
.link-btn.danger{color:var(--red);}
.link-btn:hover{text-decoration:underline;}

.primary-btn{background:var(--navy); color:#fff; border:none; padding:10px 18px; border-radius:9px; font-weight:600; cursor:pointer; font-size:13.5px;}
.primary-btn.small{padding:7px 12px; font-size:12.5px;}
.primary-btn:disabled{opacity:.5; cursor:not-allowed;}
.primary-btn:hover:not(:disabled){background:#141c30;}
.ghost-btn{background:transparent; border:1px solid var(--line); padding:9px 16px; border-radius:9px; font-weight:600; cursor:pointer; font-size:13.5px; color:var(--ink);}
.ghost-btn.small{padding:6px 12px; font-size:12.5px;}
.ghost-btn.danger{color:var(--red); border-color:#E9CFCD;}
.ghost-btn:hover{background:var(--paper);}
.ghost-btn:disabled{opacity:.45; cursor:not-allowed;}
.danger-btn{background:var(--red); color:#fff; border:none; padding:9px 16px; border-radius:9px; font-weight:600; cursor:pointer;}
.chip-btn{background:var(--paper); border:1px solid var(--line); padding:6px 12px; border-radius:20px; font-size:12.5px; cursor:pointer; font-weight:500;}
.chip-btn:hover{border-color:var(--gold);}
.icon-btn{background:none; border:none; color:var(--ink-soft); cursor:pointer; font-size:14px;}
.icon-btn:hover{color:var(--red);}

.row-gap{display:flex; gap:8px; align-items:center; flex-wrap:wrap;}
.row-gap.end{justify-content:flex-end; margin-top:10px;}

.grid-2{display:grid; grid-template-columns:1fr 1fr; gap:16px;}
.two-col{display:grid; grid-template-columns:1fr 1fr; gap:12px;}

.fld{display:flex; flex-direction:column; gap:4px; margin-bottom:12px;}
.fld-label{font-size:12px; font-weight:600; color:var(--ink-soft);}
.fld-hint{font-size:11px; color:var(--ink-soft);}
input, select, textarea{font-family:inherit; font-size:13.5px; padding:8px 10px; border:1px solid var(--line); border-radius:8px; background:#fff; color:var(--ink); width:100%;}
input:focus, select:focus, textarea:focus{outline:2px solid var(--gold); outline-offset:1px; border-color:var(--gold);}
.checkbox-row{display:flex; align-items:center; gap:8px; font-size:13px; margin-bottom:10px;}
.checkbox-row input{width:auto;}

.items-table input, .items-table select, .items-table textarea{padding:6px 8px; font-size:13px;}
.items-table td{vertical-align:top;}
.num{text-align:right; font-family:'IBM Plex Mono',monospace;}

.totals-card{max-width:380px; margin-left:auto;}
.totals-row{display:flex; justify-content:space-between; padding:6px 0; font-family:'IBM Plex Mono',monospace; font-size:13.5px;}
.totals-row.grand{border-top:2px solid var(--navy); margin-top:6px; padding-top:10px; font-weight:700; font-size:16px;}

.filters-row{display:flex; gap:10px; flex-wrap:wrap;}
.filters-row input, .filters-row select{width:auto; min-width:170px;}
.status-select{padding:5px 8px; font-size:12px;}

.badge{padding:3px 10px; border-radius:20px; font-size:11.5px; font-weight:700;}

.entity-card{display:flex; flex-direction:column; gap:6px;}
.entity-head{display:flex; align-items:center; gap:10px;}
.entity-title{font-weight:700; font-family:'Lora',serif;}

.error-banner{background:#FBEAEA; color:var(--red); border:1px solid #EAC5C3; padding:10px 14px; border-radius:8px; font-size:13px;}

.toast{position:fixed; bottom:22px; right:26px; background:var(--navy); color:#fff; padding:12px 20px; border-radius:10px; font-size:13.5px; box-shadow:0 8px 24px rgba(0,0,0,.2);}

.modal-backdrop{position:fixed; inset:0; background:rgba(20,20,25,.45); display:flex; align-items:center; justify-content:center; z-index:50; padding:20px;}
.modal{background:#fff; border-radius:14px; padding:26px 28px; max-width:520px; width:100%; max-height:88vh; overflow:auto;}
.modal.small{max-width:360px;}
.modal h3{margin-top:0; font-family:'Lora',serif;}

.preview-modal{max-width:850px; padding:0; background:#EFEBE0; max-height:92vh; overflow:auto;}
.preview-toolbar{display:flex; justify-content:space-between; align-items:center; padding:14px 22px; font-weight:600; border-bottom:1px solid var(--line); position:sticky; top:0; background:#EFEBE0; z-index:2;}

/* ---- invoice sheet, styled to mirror the source tax-invoice layout ---- */
.invoice-sheet{background:#fff; margin:18px; padding:26px 30px 34px; font-size:12px; color:#111; font-family:'Inter',sans-serif; line-height:1.35;}
.inv-topline{position:relative; text-align:center; margin-bottom:10px; height:18px;}
.inv-kicker-center{font-weight:700; font-size:13px; letter-spacing:.12em; color:#1a3a8f;}
.inv-kicker-right{position:absolute; right:0; top:0; font-size:10px; letter-spacing:.06em; font-weight:600; color:#333;}

.inv-frame{border:1.4px solid #111;}
.inv-company-block{position:relative; text-align:center; padding:10px 14px 10px 80px; border-bottom:1.4px solid #111;}
.inv-logo-float{position:absolute; left:14px; top:50%; transform:translateY(-50%);}
.inv-company-name{font-family:'Lora',serif; font-weight:700; font-size:16px; letter-spacing:.01em;}
.inv-company-sub{font-size:11px; color:#222; margin-top:1px;}
.bold-inline{font-weight:700;}

.inv-parties{display:grid; grid-template-columns:1fr 1fr; border-bottom:1.4px solid #111;}
.inv-box{padding:8px 14px; border-right:1.4px solid #111; min-height:120px;}
.inv-box:last-child{border-right:none;}
.inv-box-title{font-weight:700; font-size:11.5px;}
.inv-box-title.mt{margin-top:8px;}
.inv-meta-row{display:flex; justify-content:space-between; gap:10px; font-size:11.5px; margin-bottom:2px;}
.pre{white-space:pre-wrap; font-size:11.5px;}
.bold{font-weight:700;}
.italic{font-style:italic;}
.right-float{float:right;}

.inv-items-table{width:100%; border-collapse:collapse; font-size:11.5px;}
.inv-items-table th{border-bottom:1.4px solid #111; padding:5px 8px; background:#F5F3EA; text-align:left; font-size:11px;}
.inv-items-table td{border-bottom:1px solid #ccc; padding:5px 8px; vertical-align:top;}
.right{text-align:right; font-weight:600;}
.subtotal-row td{border-top:1px solid #999;}
.total-row td{font-weight:700; border-top:1.4px solid #111; border-bottom:1.4px solid #111;}

.inv-words{border-bottom:1.4px solid #111; padding:7px 12px; font-size:11.5px;}
.inv-words::after{content:""; display:table; clear:both;}

.inv-hsn-table{width:100%; border-collapse:collapse; font-size:11.5px; border-bottom:1.4px solid #111;}
.inv-hsn-table th{border:1px solid #999; padding:5px 8px; background:#F5F3EA; text-align:center;}
.inv-hsn-table td{border:1px solid #ccc; padding:5px 8px; text-align:center;}

.inv-payable{border-bottom:1.4px solid #111; padding:7px 12px; text-align:right; font-size:12.5px; background:#F9F7EF;}
.inv-bottom{display:grid; grid-template-columns:1fr 1fr;}
.right-align{text-align:right;}
.signatory{margin-top:34px; font-weight:600; font-size:11px;}
.inv-notes{margin-top:10px; font-size:11px; color:#444; padding:0 2px;}

@media print{
  @page { size: A4; margin: 12mm 10mm; }
  html, body{ height:auto !important; }
  body *{visibility:hidden;}
  #print-area, #print-area *{visibility:visible;}
  #print-area{position:absolute; top:0; left:0; width:100%; margin:0; background:#fff;}
  .no-print{display:none !important;}

  /* The preview modal is a scrollable, fixed-height box on screen — that's exactly
     what causes "PDF doesn't match the screen" and clipped/blank pages. On print,
     unlock it back into a normal flowing block so the browser can paginate the
     full invoice across as many A4 pages as it needs. */
  .modal-backdrop{position:static !important; background:none !important; padding:0 !important; display:block !important;}
  .modal.preview-modal{position:static !important; max-width:none !important; max-height:none !important; overflow:visible !important; background:#fff !important; box-shadow:none !important;}
  .preview-toolbar{display:none !important;}
  .invoice-sheet{margin:0 !important; padding:0 !important;}
  .inv-frame{border:1.4px solid #111 !important;}

  /* Multi-page invoices: repeat the item-table header on every page, never split
     a row across a page break, and keep each self-contained block (party details,
     totals, HSN summary, bank/signature) together rather than orphaning a line. */
  .inv-items-table thead{display:table-header-group;}
  .inv-items-table tr, .inv-hsn-table tr{break-inside:avoid; page-break-inside:avoid;}
  .inv-topline, .inv-company-block, .inv-parties, .inv-words, .inv-hsn-table,
  .inv-payable, .inv-bottom, .inv-notes{break-inside:avoid; page-break-inside:avoid;}
  .inv-bottom{break-before:avoid; page-break-before:avoid;}

  /* Print backgrounds/colors exactly as shown on screen (table header shading, totals row, etc). */
  *{ -webkit-print-color-adjust:exact; print-color-adjust:exact; }
}

@media (max-width:860px){
  .grid-2{grid-template-columns:1fr;}
  .two-col{grid-template-columns:1fr;}
  .stat-grid{grid-template-columns:1fr 1fr;}
  .stat-grid-6{grid-template-columns:1fr 1fr;}
  .dash-grid{grid-template-columns:1fr;}
  .sidebar{position:fixed; left:-240px; top:0; bottom:0; z-index:40; transition:left .2s; box-shadow:6px 0 20px rgba(0,0,0,.15);}
  .sidebar.open{left:0;}
  .menu-toggle{display:block; position:fixed; top:14px; left:14px; z-index:41; background:var(--navy); color:#fff; border:none; width:38px; height:38px; border-radius:9px; font-size:16px; cursor:pointer;}
  .main-area{padding:70px 16px 30px;}
  .inv-parties, .inv-bottom{grid-template-columns:1fr;}
  .inv-box{border-right:none; border-bottom:1px solid #111;}
  .inv-company-block{padding-left:14px; padding-top:60px;}
  .inv-logo-float{left:50%; top:14px; transform:translateX(-50%);}
}
`;

