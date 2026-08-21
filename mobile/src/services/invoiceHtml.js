import { fmt, computeInvoice, amountInWordsPaise, fromPaise } from "./money";

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Builds the full invoice HTML — used both for the in-app preview (rendered in
 * a WebView) and for PDF export (fed to expo-print). Keeping one rendering
 * model for both means the PDF always matches what the user just reviewed.
 */
export function buildInvoiceHtml(invoice, company, customer) {
  const computed = computeInvoice(invoice.items, company, customer);
  const grandTotalPaise = computed.grandTotalPaise;

  const itemRows = computed.items.map((it, i) => `
    <tr>
      <td class="c">${i + 1}</td>
      <td>${esc(it.description || "—")}</td>
      <td class="c">${esc(it.hsn || "—")}</td>
      <td class="r">${Number(it.qty)}</td>
      <td class="r">${fmt(it.rate)}</td>
      <td class="r">${fmt(fromPaise(it.taxableAmountPaise))}</td>
      <td class="r">${Number(it.taxRate) || 0}%</td>
      <td class="r">${fmt(fromPaise(it.totalPaise))}</td>
    </tr>`).join("");

  const taxLines = computed.interstate
    ? `<tr><td>IGST</td><td class="r">${fmt(fromPaise(computed.igstPaise))}</td></tr>`
    : `<tr><td>CGST</td><td class="r">${fmt(fromPaise(computed.cgstPaise))}</td></tr>
       <tr><td>SGST</td><td class="r">${fmt(fromPaise(computed.sgstPaise))}</td></tr>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>
  @page { size: A4; margin: 12mm 10mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: -apple-system, Roboto, Helvetica, Arial, sans-serif; color: #111; font-size: 12px; margin: 0; }
  .sheet { padding: 4mm; }
  .frame { border: 1.4px solid #111; }
  .topline { display:flex; justify-content:space-between; align-items:flex-start; padding: 10px 14px; border-bottom: 1px solid #111; }
  .company-name { font-size: 18px; font-weight: 700; margin: 0; }
  .muted { color: #555; }
  .tag { display:inline-block; padding: 3px 10px; border: 1px solid #111; border-radius: 3px; font-weight:700; font-size:11px; }
  .parties { display:flex; border-bottom: 1px solid #111; }
  .party { flex:1; padding: 10px 14px; }
  .party + .party { border-left: 1px solid #111; }
  .party h4 { margin: 0 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color:#555; }
  table.items { width:100%; border-collapse: collapse; break-inside: avoid; }
  table.items thead { display: table-header-group; }
  table.items th, table.items td { border: 1px solid #111; padding: 5px 6px; font-size: 11.5px; }
  table.items th { background: #f1efe8; text-align:left; }
  table.items tr { break-inside: avoid; page-break-inside: avoid; }
  .c { text-align:center; } .r { text-align:right; }
  .bottom { display:flex; border-top: none; break-inside: avoid; page-break-inside: avoid; }
  .words { flex:1.4; padding: 10px 14px; border-right: 1px solid #111; border-left:1px solid #111; border-bottom:1px solid #111; }
  .totals { flex:1; border-right:1px solid #111; border-bottom:1px solid #111; }
  .totals table { width:100%; border-collapse: collapse; }
  .totals td { padding: 4px 10px; font-size: 12px; }
  .totals tr.grand td { font-weight:700; font-size: 13.5px; border-top: 1px solid #111; }
  .notes { padding: 10px 14px; border-left:1px solid #111; border-right:1px solid #111; border-bottom:1px solid #111; font-size:11px; color:#333; }
  .sign { display:flex; justify-content:flex-end; padding: 26px 14px 10px; border-left:1px solid #111; border-right:1px solid #111; border-bottom:1px solid #111; }
  .sign div { text-align:center; font-size: 11px; }
  .sign .line { margin-top: 30px; border-top: 1px solid #111; padding-top: 4px; width: 160px; }
</style></head>
<body>
  <div class="sheet frame">
    <div class="topline">
      <div>
        <p class="company-name">${esc(company?.name || "Company")}</p>
        <p class="muted">${esc(company?.address || "")}</p>
        <p class="muted">GSTIN: ${esc(company?.gstin || "—")} ${company?.mobile ? " · " + esc(company.mobile) : ""}</p>
      </div>
      <div style="text-align:right">
        <span class="tag">TAX INVOICE</span>
        <p style="margin:6px 0 0">No: <b>${esc(invoice.invoiceNo)}</b></p>
        <p class="muted">Date: ${esc(invoice.invoiceDate)}</p>
        ${invoice.status === "cancelled" ? '<p style="color:#B8433D;font-weight:700">CANCELLED</p>' : ""}
      </div>
    </div>
    <div class="parties">
      <div class="party">
        <h4>Billed to</h4>
        <p><b>${esc(customer?.name || invoice.customerSnapshot?.name || "—")}</b></p>
        <p class="muted">${esc(customer?.billingAddress || invoice.customerSnapshot?.billingAddress || "")}</p>
        <p class="muted">GSTIN: ${esc(customer?.gstin || invoice.customerSnapshot?.gstin || "—")}</p>
      </div>
      <div class="party">
        <h4>Shipped to</h4>
        <p class="muted">${esc(customer?.shippingAddress || invoice.customerSnapshot?.shippingAddress || customer?.billingAddress || "Same as billing")}</p>
      </div>
    </div>
    <table class="items">
      <thead><tr><th class="c">#</th><th>Description</th><th class="c">HSN/SAC</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Taxable</th><th class="r">GST</th><th class="r">Total</th></tr></thead>
      <tbody>${itemRows}</tbody>
    </table>
    <div class="bottom">
      <div class="words">
        <h4 class="muted" style="margin:0 0 4px;font-size:11px;text-transform:uppercase">Amount in words</h4>
        <p><b>${esc(amountInWordsPaise(grandTotalPaise))}</b></p>
        ${company?.bankName ? `<h4 class="muted" style="margin:12px 0 4px;font-size:11px;text-transform:uppercase">Bank details</h4>
        <p class="muted">${esc(company.bankName)} · A/C ${esc(company.accountNo || "")}<br/>IFSC ${esc(company.ifsc || "")} · ${esc(company.branch || "")}</p>` : ""}
      </div>
      <div class="totals">
        <table>
          <tr><td>Subtotal</td><td class="r">${fmt(fromPaise(computed.subtotalPaise))}</td></tr>
          ${taxLines}
          <tr><td>Round off</td><td class="r">${fmt(fromPaise(computed.roundOffPaise))}</td></tr>
          <tr class="grand"><td>Grand Total</td><td class="r">₹ ${fmt(fromPaise(grandTotalPaise))}</td></tr>
        </table>
      </div>
    </div>
    ${invoice.notes ? `<div class="notes"><b>Notes:</b> ${esc(invoice.notes)}</div>` : ""}
    <div class="sign">
      <div>
        <p>For ${esc(company?.name || "Company")}</p>
        <div class="line">Authorized Signatory</div>
      </div>
    </div>
  </div>
</body></html>`;
}
