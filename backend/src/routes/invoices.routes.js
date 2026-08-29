import { Router } from "express";
import { z } from "zod";
import { pool, withTransaction } from "../db/pool.js";
import { requireAuth, requireCompanyOwnership } from "../middleware/auth.js";
import { computeInvoiceServer, toPaise, fromPaise, amountInWordsPaise } from "../utils/money.js";
import { HttpError } from "../middleware/errorHandler.js";

const router = Router();
router.use(requireAuth);

const ALLOWED_TRANSITIONS = {
  draft: ["sent"],
  sent: ["partial", "paid", "cancelled"],
  partial: ["paid", "cancelled"],
  paid: [],
  cancelled: [],
};

// Numeric strings/numbers that must be finite and non-negative (quantity is additionally > 0).
const nonNegativeAmount = z.union([z.number(), z.string()]).refine(
  (v) => Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) < 1_000_000_000,
  { message: "Amount must be a non-negative number under 1,000,000,000." }
);
const positiveQuantity = z.union([z.number(), z.string()]).refine(
  (v) => Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) < 1_000_000,
  { message: "Quantity must be a positive number." }
);

const itemSchema = z.object({
  productId: z.string().uuid().optional().nullable(),
  productName: z.string().trim().min(1),
  hsnSac: z.string().trim().optional().nullable(),
  quantity: positiveQuantity,
  unit: z.string().trim().optional().nullable(),
  rate: nonNegativeAmount,
  gstRate: z.number().min(0).max(100).default(0),
});

const invoiceSchema = z.object({
  companyId: z.string().uuid(),
  customerId: z.string().uuid().optional().nullable(),
  invoiceDate: z.string().min(1),
  dueDate: z.string().optional().nullable(),
  billingMonth: z.string().regex(/^\d{4}-\d{2}$/, "Billing month must be in YYYY-MM format.").optional().nullable(),
  notes: z.string().optional().nullable(),
  terms: z.string().optional().nullable(),
  discount: nonNegativeAmount.optional().nullable(),
  items: z.array(itemSchema).min(1, "At least one line item is required."),
  finalize: z.boolean().optional().default(false), // true = assign as a locked/sent invoice
});

/** Indian financial year (Apr–Mar) as e.g. '2026/27' for any date in that year. */
function financialYearOf(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1; // 1-12
  const startYear = m >= 4 ? y : y - 1;
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/**
 * Assigns the next invoice number for a company, honoring that company's own
 * numbering settings (prefix, zero-padding, and whether the sequence resets
 * every financial year). Numbering settings live in companies.bank_details
 * (a JSONB blob also used for bank details) — see company.routes.js.
 *
 * The increment is a single atomic UPDATE...RETURNING inside the caller's
 * transaction, so two concurrent saves for the same company can never be
 * handed the same number, and a number is never reused (the counter only
 * ever increases, even if the draft that reserved it is later deleted).
 */
async function nextInvoiceNumber(client, companyId, invoiceDateStr) {
  const { rows: companyRows } = await client.query("SELECT bank_details FROM companies WHERE id = $1", [companyId]);
  const settings = companyRows[0]?.bank_details || {};
  const prefix = typeof settings.invoicePrefix === "string" && settings.invoicePrefix.trim() ? settings.invoicePrefix : "INV-";
  const padding = Number.isFinite(Number(settings.numberPadding)) && Number(settings.numberPadding) > 0 ? Number(settings.numberPadding) : 4;
  const fyResetEnabled = !!settings.fyResetEnabled;
  const bucket = fyResetEnabled ? financialYearOf(invoiceDateStr) : "ALL";

  const { rows } = await client.query(
    `INSERT INTO invoice_counters (company_id, bucket, last_seq)
     VALUES ($1, $2, 1)
     ON CONFLICT (company_id, bucket)
     DO UPDATE SET last_seq = invoice_counters.last_seq + 1
     RETURNING last_seq`,
    [companyId, bucket]
  );
  const seq = rows[0].last_seq;
  return `${prefix}${String(seq).padStart(padding, "0")}`;
}

async function getCompanyAndCustomer(client, companyId, customerId) {
  const companyRes = await client.query("SELECT * FROM companies WHERE id = $1", [companyId]);
  const company = companyRes.rows[0];
  let customer = null;
  if (customerId) {
    // A customer can be linked to more than one company (customer_companies),
    // so membership - not customers.company_id directly - is what determines
    // whether this company is allowed to bill them.
    const custRes = await client.query(
      `SELECT c.* FROM customers c
       JOIN customer_companies cc ON cc.customer_id = c.id
       WHERE c.id = $1 AND cc.company_id = $2`,
      [customerId, companyId]
    );
    customer = custRes.rows[0] || null;
  }
  return { company, customer };
}

function itemsToApi(rows) {
  return rows.map((r) => ({
    id: r.id,
    productId: r.product_id,
    productName: r.product_name_snapshot,
    hsnSac: r.hsn_sac,
    quantity: Number(r.quantity),
    unit: r.unit,
    rate: fromPaise(BigInt(r.rate_paise)),
    gstRate: Number(r.gst_rate),
    taxableAmount: fromPaise(BigInt(r.taxable_amount_paise)),
    cgst: fromPaise(BigInt(r.cgst_paise)),
    sgst: fromPaise(BigInt(r.sgst_paise)),
    igst: fromPaise(BigInt(r.igst_paise)),
    total: fromPaise(BigInt(r.total_paise)),
  }));
}

function invoiceToApi(row, items) {
  return {
    id: row.id,
    companyId: row.company_id,
    customerId: row.customer_id,
    customerSnapshot: row.customer_snapshot,
    invoiceNumber: row.invoice_number,
    invoiceDate: row.invoice_date,
    dueDate: row.due_date,
    billingMonth: row.billing_month,
    status: row.status,
    finalized: row.finalized,
    subtotal: fromPaise(BigInt(row.subtotal_paise)),
    discount: fromPaise(BigInt(row.discount_paise)),
    taxableAmount: fromPaise(BigInt(row.taxable_amount_paise)),
    cgst: fromPaise(BigInt(row.cgst_paise)),
    sgst: fromPaise(BigInt(row.sgst_paise)),
    igst: fromPaise(BigInt(row.igst_paise)),
    roundOff: fromPaise(BigInt(row.round_off_paise)),
    grandTotal: fromPaise(BigInt(row.grand_total_paise)),
    amountInWords: amountInWordsPaise(BigInt(row.grand_total_paise)),
    notes: row.notes,
    terms: row.terms,
    duplicatedFrom: row.duplicated_from,
    deleted: !!row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: items ? itemsToApi(items) : undefined,
  };
}

async function loadOwnedInvoice(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT i.* FROM invoices i JOIN companies co ON co.id = i.company_id
       WHERE i.id = $1 AND co.user_id = $2`,
      [req.params.id, req.userId]
    );
    if (!rows.length) return res.status(404).json({ error: "Invoice not found." });
    req.invoiceRow = rows[0];
    next();
  } catch (err) { next(err); }
}

// GET /api/invoices?companyId=...&status=&search=
router.get("/", requireCompanyOwnership, async (req, res, next) => {
  try {
    const { status, search } = req.query;
    const params = [req.companyId];
    let sql = `SELECT i.*, c.name AS customer_name,
                 COALESCE(
                   (SELECT json_agg(ii.* ORDER BY ii.sort_order)
                    FROM invoice_items ii WHERE ii.invoice_id = i.id),
                   '[]'
                 ) AS items_json
               FROM invoices i
               LEFT JOIN customers c ON c.id = i.customer_id
               WHERE i.company_id = $1 AND i.deleted_at IS NULL`;
    if (status) { params.push(status); sql += ` AND i.status = $${params.length}`; }
    if (search) { params.push(`%${search}%`); sql += ` AND (i.invoice_number ILIKE $${params.length} OR c.name ILIKE $${params.length})`; }
    sql += " ORDER BY i.created_at DESC";
    const { rows } = await pool.query(sql, params);
    res.json({ invoices: rows.map((r) => ({ ...invoiceToApi(r, r.items_json), customerName: r.customer_name })) });
  } catch (err) { next(err); }
});

router.get("/:id", loadOwnedInvoice, async (req, res, next) => {
  try {
    const { rows: items } = await pool.query("SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order ASC", [req.params.id]);
    res.json({ invoice: invoiceToApi(req.invoiceRow, items) });
  } catch (err) { next(err); }
});

async function persistInvoiceItems(client, invoiceId, computed) {
  await client.query("DELETE FROM invoice_items WHERE invoice_id = $1", [invoiceId]);
  let order = 0;
  for (const it of computed.items) {
    await client.query(
      `INSERT INTO invoice_items
        (invoice_id, product_id, product_name_snapshot, hsn_sac, quantity, unit, rate_paise, gst_rate,
         taxable_amount_paise, cgst_paise, sgst_paise, igst_paise, total_paise, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [invoiceId, it.productId || null, it.productName, it.hsnSac || null, it.quantity, it.unit || "Nos",
       toPaise(it.rate).toString(), it.gstRate ?? 0, it.taxableAmountPaise.toString(),
       it.cgstPaise.toString(), it.sgstPaise.toString(), it.igstPaise.toString(), it.totalPaise.toString(), order++]
    );
  }
}

// POST /api/invoices — creates a draft, or a finalized/sent invoice when finalize:true
router.post("/", requireCompanyOwnership, async (req, res, next) => {
  try {
    const body = invoiceSchema.parse(req.body);
    const result = await withTransaction(async (client) => {
      const { company, customer } = await getCompanyAndCustomer(client, req.companyId, body.customerId);
      if (!company) throw new HttpError(404, "Company not found.");

      const discountPaise = toPaise(body.discount ?? 0);
      const computed = computeInvoiceServer(body.items, company, customer, discountPaise);
      const grandTotalPaise = computed.grandTotalPaise;

      const invoiceNumber = await nextInvoiceNumber(client, req.companyId, body.invoiceDate);
      const status = body.finalize ? "sent" : "draft";

      const { rows } = await client.query(
        `INSERT INTO invoices
          (company_id, customer_id, customer_snapshot, invoice_number, invoice_date, due_date, billing_month, status, finalized,
           subtotal_paise, discount_paise, taxable_amount_paise, cgst_paise, sgst_paise, igst_paise, round_off_paise,
           grand_total_paise, notes, terms)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
        [req.companyId, body.customerId || null, customer ? JSON.stringify(customer) : null, invoiceNumber,
         body.invoiceDate, body.dueDate || null, body.billingMonth || null, status, body.finalize,
         computed.subtotalPaise.toString(), discountPaise.toString(), computed.taxableAmountPaise.toString(),
         computed.cgstPaise.toString(), computed.sgstPaise.toString(), computed.igstPaise.toString(),
         computed.roundOffPaise.toString(), grandTotalPaise.toString(), body.notes || null, body.terms || null]
      );
      const invoiceRow = rows[0];
      await persistInvoiceItems(client, invoiceRow.id, computed);
      await client.query(
        `INSERT INTO audit_logs (company_id, user_id, entity_type, entity_id, action, new_value)
         VALUES ($1,$2,'invoice',$3,$4,$5)`,
        [req.companyId, req.userId, invoiceRow.id, body.finalize ? "Finalized" : "Created", JSON.stringify({ invoiceNumber, grandTotal: fromPaise(grandTotalPaise) })]
      );
      return invoiceRow;
    });
    res.status(201).json({ invoice: invoiceToApi(result) });
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: err.issues[0]?.message || "Invalid input." });
    next(err);
  }
});

// PUT /api/invoices/:id — edit a draft (or an unfinalized invoice). Finalized invoices are immutable.
router.put("/:id", loadOwnedInvoice, async (req, res, next) => {
  try {
    if (req.invoiceRow.finalized) {
      return res.status(409).json({ error: "Finalized invoices are immutable. Use Duplicate & Correct to make changes." });
    }
    if (req.invoiceRow.deleted_at) return res.status(409).json({ error: "This invoice has been removed." });

    const body = invoiceSchema.parse({ ...req.body, companyId: req.invoiceRow.company_id });
    const result = await withTransaction(async (client) => {
      const { company, customer } = await getCompanyAndCustomer(client, req.invoiceRow.company_id, body.customerId);
      const discountPaise = toPaise(body.discount ?? 0);
      const computed = computeInvoiceServer(body.items, company, customer, discountPaise);
      const grandTotalPaise = computed.grandTotalPaise;
      const status = body.finalize ? "sent" : "draft";

      const { rows } = await client.query(
        `UPDATE invoices SET customer_id=$1, customer_snapshot=$2, invoice_date=$3, due_date=$4, billing_month=$5, status=$6, finalized=$7,
           subtotal_paise=$8, discount_paise=$9, taxable_amount_paise=$10, cgst_paise=$11, sgst_paise=$12, igst_paise=$13,
           round_off_paise=$14, grand_total_paise=$15, notes=$16, terms=$17
         WHERE id=$18 RETURNING *`,
        [body.customerId || null, customer ? JSON.stringify(customer) : null, body.invoiceDate, body.dueDate || null,
         body.billingMonth || null, status, body.finalize, computed.subtotalPaise.toString(), discountPaise.toString(), computed.taxableAmountPaise.toString(),
         computed.cgstPaise.toString(), computed.sgstPaise.toString(), computed.igstPaise.toString(),
         computed.roundOffPaise.toString(), grandTotalPaise.toString(), body.notes || null, body.terms || null, req.params.id]
      );
      const invoiceRow = rows[0];
      await persistInvoiceItems(client, invoiceRow.id, computed);
      await client.query(
        `INSERT INTO audit_logs (company_id, user_id, entity_type, entity_id, action, old_value, new_value)
         VALUES ($1,$2,'invoice',$3,$4,$5,$6)`,
        [req.invoiceRow.company_id, req.userId, invoiceRow.id, body.finalize ? "Finalized" : "Edited",
         JSON.stringify(invoiceToApi(req.invoiceRow)), JSON.stringify({ invoiceNumber: invoiceRow.invoice_number })]
      );
      return invoiceRow;
    });
    res.json({ invoice: invoiceToApi(result) });
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: err.issues[0]?.message || "Invalid input." });
    next(err);
  }
});

// POST /api/invoices/:id/status — controlled lifecycle transitions (sent -> partial/paid, etc.)
router.post("/:id/status", loadOwnedInvoice, async (req, res, next) => {
  try {
    const schema = z.object({ status: z.enum(["draft", "sent", "partial", "paid", "cancelled"]) });
    const { status } = schema.parse(req.body);
    const from = req.invoiceRow.status;
    if (from !== status && !(ALLOWED_TRANSITIONS[from] || []).includes(status)) {
      return res.status(409).json({ error: `Cannot move an invoice from "${from}" to "${status}".` });
    }
    const { rows } = await pool.query("UPDATE invoices SET status = $1 WHERE id = $2 RETURNING *", [status, req.params.id]);
    await pool.query(
      `INSERT INTO audit_logs (company_id, user_id, entity_type, entity_id, action, old_value, new_value)
       VALUES ($1,$2,'invoice',$3,$4,$5,$6)`,
      [req.invoiceRow.company_id, req.userId, req.params.id, status === "cancelled" ? "Cancelled" : "Status changed",
       JSON.stringify({ status: from }), JSON.stringify({ status })]
    );
    res.json({ invoice: invoiceToApi(rows[0]) });
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: "Invalid status." });
    next(err);
  }
});

// POST /api/invoices/:id/cancel — convenience wrapper (finalized invoices only; drafts should be deleted instead)
router.post("/:id/cancel", loadOwnedInvoice, async (req, res, next) => {
  try {
    if (!req.invoiceRow.finalized) return res.status(409).json({ error: "Draft invoices should be deleted, not cancelled." });
    if (req.invoiceRow.status === "cancelled") return res.status(409).json({ error: "This invoice is already cancelled." });
    if (req.invoiceRow.status === "paid") return res.status(409).json({ error: "Paid invoices cannot be cancelled directly." });
    const { rows } = await pool.query("UPDATE invoices SET status = 'cancelled' WHERE id = $1 RETURNING *", [req.params.id]);
    await pool.query(
      `INSERT INTO audit_logs (company_id, user_id, entity_type, entity_id, action, old_value)
       VALUES ($1,$2,'invoice',$3,'Cancelled',$4)`,
      [req.invoiceRow.company_id, req.userId, req.params.id, JSON.stringify({ status: req.invoiceRow.status })]
    );
    res.json({ invoice: invoiceToApi(rows[0]) });
  } catch (err) { next(err); }
});

// POST /api/invoices/:id/duplicate — "Duplicate & Correct": new invoice, new number, original untouched
router.post("/:id/duplicate", loadOwnedInvoice, async (req, res, next) => {
  try {
    const result = await withTransaction(async (client) => {
      const { rows: items } = await client.query("SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order ASC", [req.params.id]);
      const src = req.invoiceRow;
      const newInvoiceDate = new Date().toISOString().slice(0, 10);
      const invoiceNumber = await nextInvoiceNumber(client, src.company_id, newInvoiceDate);
      const { rows } = await client.query(
        `INSERT INTO invoices
          (company_id, customer_id, customer_snapshot, invoice_number, invoice_date, due_date, billing_month, status, finalized,
           subtotal_paise, discount_paise, taxable_amount_paise, cgst_paise, sgst_paise, igst_paise, round_off_paise,
           grand_total_paise, notes, terms, duplicated_from)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',false,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
        [src.company_id, src.customer_id, src.customer_snapshot, invoiceNumber,
         newInvoiceDate, src.due_date, src.billing_month,
         src.subtotal_paise, src.discount_paise, src.taxable_amount_paise, src.cgst_paise, src.sgst_paise,
         src.igst_paise, src.round_off_paise, src.grand_total_paise, src.notes, src.terms, src.id]
      );
      const newInvoice = rows[0];
      let order = 0;
      for (const it of items) {
        await client.query(
          `INSERT INTO invoice_items
            (invoice_id, product_id, product_name_snapshot, hsn_sac, quantity, unit, rate_paise, gst_rate,
             taxable_amount_paise, cgst_paise, sgst_paise, igst_paise, total_paise, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [newInvoice.id, it.product_id, it.product_name_snapshot, it.hsn_sac, it.quantity, it.unit, it.rate_paise,
           it.gst_rate, it.taxable_amount_paise, it.cgst_paise, it.sgst_paise, it.igst_paise, it.total_paise, order++]
        );
      }
      await client.query(
        `INSERT INTO audit_logs (company_id, user_id, entity_type, entity_id, action, new_value)
         VALUES ($1,$2,'invoice',$3,'Duplicated & Corrected',$4)`,
        [src.company_id, req.userId, newInvoice.id, JSON.stringify({ from: src.invoice_number, to: invoiceNumber })]
      );
      return { newInvoice, items };
    });
    res.status(201).json({ invoice: invoiceToApi(result.newInvoice, undefined) });
  } catch (err) { next(err); }
});

// DELETE /api/invoices/:id — hard-delete drafts, soft-delete finalized (audit-friendly)
router.delete("/:id", loadOwnedInvoice, async (req, res, next) => {
  try {
    if (req.invoiceRow.finalized) {
      await pool.query("UPDATE invoices SET deleted_at = now() WHERE id = $1", [req.params.id]);
      await pool.query(
        `INSERT INTO audit_logs (company_id, user_id, entity_type, entity_id, action)
         VALUES ($1,$2,'invoice',$3,'Removed (soft-delete, finalized)')`,
        [req.invoiceRow.company_id, req.userId, req.params.id]
      );
      return res.json({ ok: true, softDeleted: true });
    }
    await pool.query("DELETE FROM invoices WHERE id = $1", [req.params.id]);
    await pool.query(
      `INSERT INTO audit_logs (company_id, user_id, entity_type, entity_id, action)
       VALUES ($1,$2,'invoice',$3,'Deleted (draft)')`,
      [req.invoiceRow.company_id, req.userId, req.params.id]
    );
    res.json({ ok: true, softDeleted: false });
  } catch (err) { next(err); }
});

export default router;
