import { stateFromGSTIN } from "./money";

export function companyFromApi(row) {
  const extra = row.bankDetails || {};
  return {
    id: row.id, name: row.companyName, gstin: row.gstin || "", pan: extra.pan || "",
    address: row.address || "", mobile: row.phone || "", email: row.email || "",
    bankName: extra.bankName || "", accountNo: extra.accountNo || "", ifsc: extra.ifsc || "",
    branch: extra.branch || "", state: row.state || stateFromGSTIN(row.gstin) || "",
  };
}
export function companyToApi(c) {
  return {
    companyName: c.name, gstin: c.gstin || "", address: c.address || "", phone: c.mobile || "",
    email: c.email || "", state: stateFromGSTIN(c.gstin) || "",
    bankDetails: { pan: c.pan || "", bankName: c.bankName || "", accountNo: c.accountNo || "", ifsc: c.ifsc || "", branch: c.branch || "" },
  };
}

export function customerFromApi(row) {
  return {
    id: row.id, companyId: row.companyId, name: row.name, phone: row.phone || "", gstin: row.gstin || "",
    billingAddress: row.billingAddress || "", shippingAddress: row.shippingAddress || "",
    state: row.state || stateFromGSTIN(row.gstin) || "",
  };
}
export function customerToApi(c, companyId) {
  return {
    companyId, name: c.name, gstin: c.gstin || "", billingAddress: c.billingAddress || "",
    shippingAddress: c.shippingAddress || "", phone: c.phone || "", state: c.state || stateFromGSTIN(c.gstin) || "",
  };
}

export function productFromApi(row) {
  return { id: row.id, companyId: row.companyId, name: row.name, description: row.description || "", hsn: row.hsnSac || "", unit: row.unit || "Nos", rate: row.rate, taxRate: row.gstRate };
}
export function productToApi(p, companyId) {
  return { companyId, name: p.name, description: p.description || "", hsnSac: p.hsn || "", unit: p.unit || "Nos", rate: p.rate || 0, gstRate: Number(p.taxRate) || 0 };
}

export function invoiceToApiPayload(inv) {
  return {
    companyId: inv.companyId, customerId: inv.customerId || null, invoiceDate: inv.invoiceDate,
    dueDate: inv.dueDate || null, notes: inv.notes || "", terms: inv.terms || "",
    items: (inv.items || []).map((it) => ({
      productId: it.productId || null, productName: it.description || "(no description)",
      hsnSac: it.hsn || "", quantity: it.qty, unit: it.unit || "Nos", rate: it.rate || 0, gstRate: Number(it.taxRate) || 0,
    })),
    finalize: inv.finalized === true,
  };
}
export function invoiceFromApi(row) {
  const snap = row.customerSnapshot || {};
  return {
    id: row.id, companyId: row.companyId, customerId: row.customerId || "",
    customerSnapshot: {
      name: snap.name || "", phone: snap.phone || "", gstin: snap.gstin || "",
      billingAddress: snap.billing_address || snap.billingAddress || "",
      shippingAddress: snap.shipping_address || snap.shippingAddress || "",
      state: snap.state || stateFromGSTIN(snap.gstin) || "",
    },
    invoiceNo: row.invoiceNumber || "(assigned on save)",
    invoiceDate: (row.invoiceDate || "").slice(0, 10),
    dueDate: row.dueDate ? row.dueDate.slice(0, 10) : "",
    items: (row.items || []).map((it) => ({ id: it.id, productId: it.productId || "", description: it.productName, hsn: it.hsnSac || "", qty: it.quantity, rate: it.rate, taxRate: it.gstRate })),
    notes: row.notes || "", status: row.status, finalized: row.finalized, createdAt: row.createdAt,
    grandTotal: row.grandTotal, customerName: row.customerName,
  };
}

export function uid() {
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
