/**
 * Integer-paise money math, ported line-for-line from the frontend's logic so
 * server-side recomputed totals always agree with what the client displayed.
 * The backend NEVER trusts totals submitted by the browser — it recomputes
 * everything from company/customer state + line items and uses its own
 * numbers when persisting and responding.
 */

export function toPaise(x) {
  const text = String(x ?? "").trim();
  if (!/^-?\d+(\.\d{0,2})?$/.test(text)) return 0n;
  const [whole, fraction = ""] = text.split(".");
  const neg = whole.startsWith("-");
  const wholeAbs = neg ? whole.slice(1) : whole;
  const val = BigInt(wholeAbs || "0") * 100n + BigInt((fraction + "00").slice(0, 2));
  return neg ? -val : val;
}

export function fromPaise(p) {
  return Number(p) / 100;
}

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
  const quantityMilli = decimalScaled(qty, 3);
  const product = quantityMilli * toPaise(rate);
  return product >= 0n ? (product + 500n) / 1000n : (product - 500n) / 1000n;
}

const STATE_CODES = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
  "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
  "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur",
  "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
  "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
  "26": "Dadra & Nagar Haveli and Daman & Diu", "27": "Maharashtra", "28": "Andhra Pradesh (old)",
  "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu",
  "34": "Puducherry", "35": "Andaman & Nicobar", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
};
export const stateFromGSTIN = (g) => (g && g.length >= 2 ? STATE_CODES[g.slice(0, 2)] || "" : "");

/**
 * Recomputes an invoice's totals from scratch (company/customer state + raw
 * line items). This is the single source of truth used both to validate
 * client-submitted invoices and to compute what actually gets persisted.
 */
export function computeInvoiceServer(items, company, customer, discountPaise = 0n) {
  const lines = (items || []).map((it) => {
    const amountPaise = lineAmountPaise(it.quantity, it.rate);
    return { ...it, amountPaise };
  });
  const taxablePaise = lines.reduce((s, i) => s + i.amountPaise, 0n);

  const companyState = company?.gstin ? stateFromGSTIN(company.gstin) : (company?.state || "");
  const custState = customer?.gstin ? stateFromGSTIN(customer.gstin) : (customer?.state || "");
  const interstate = Boolean(companyState && custState && companyState !== custState);

  const lineResults = lines.map((it) => {
    const rate = decimalScaled(it.gstRate ?? 0, 2);
    const taxPaise = (it.amountPaise * rate + 5000n) / 10000n;
    const cgstPaise = interstate ? 0n : taxPaise / 2n;
    const sgstPaise = interstate ? 0n : taxPaise - cgstPaise;
    const igstPaise = interstate ? taxPaise : 0n;
    return {
      ...it,
      amountPaise: it.amountPaise,
      taxableAmountPaise: it.amountPaise,
      cgstPaise, sgstPaise, igstPaise,
      totalPaise: it.amountPaise + taxPaise,
    };
  });

  const cgstTotalPaise = lineResults.reduce((s, r) => s + r.cgstPaise, 0n);
  const sgstTotalPaise = lineResults.reduce((s, r) => s + r.sgstPaise, 0n);
  const igstTotalPaise = lineResults.reduce((s, r) => s + r.igstPaise, 0n);
  const totalTaxPaise = cgstTotalPaise + sgstTotalPaise + igstTotalPaise;

  // Discount is applied to the raw (post-tax) total BEFORE rounding, so the
  // stored round-off always reconciles with the actual grand total charged —
  // previously the discount was subtracted after rounding, which silently
  // broke that reconciliation whenever a discount was present.
  const rawTotalPaise = taxablePaise + totalTaxPaise - discountPaise;
  const grandTotalPaise = (rawTotalPaise >= 0n ? (rawTotalPaise + 50n) / 100n : (rawTotalPaise - 50n) / 100n) * 100n;
  const roundOffPaise = grandTotalPaise - rawTotalPaise;

  return {
    items: lineResults,
    subtotalPaise: taxablePaise,
    taxableAmountPaise: taxablePaise,
    cgstPaise: cgstTotalPaise,
    sgstPaise: sgstTotalPaise,
    igstPaise: igstTotalPaise,
    discountPaise,
    roundOffPaise,
    grandTotalPaise,
    interstate,
    companyState,
    custState,
  };
}

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
export function amountInWordsPaise(totalPaise) {
  const p = typeof totalPaise === "bigint" ? totalPaise : BigInt(Math.round(Number(totalPaise) || 0));
  const rupees = Number(p / 100n);
  const paise = Number(p % 100n);
  let words = "INR " + numberToWords(rupees) + " Rupees";
  if (paise > 0) words += " and " + numberToWords(paise) + " Paise";
  return words + " Only";
}
