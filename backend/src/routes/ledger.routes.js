import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireAuth, requireCompanyOwnership } from "../middleware/auth.js";
import { toPaise, fromPaise } from "../utils/money.js";

const router = Router();
router.use(requireAuth);

async function assertInvoiceOwned(companyId, invoiceId) {
  const { rows } = await pool.query("SELECT id FROM invoices WHERE id = $1 AND company_id = $2", [invoiceId, companyId]);
  return !!rows.length;
}

/**
 * Single source of truth for "is this invoice paid/partial/still owed", computed
 * server-side from actual recorded payments and credit/debit notes — never
 * trusted from the client. Called after every payment create/void so the
 * invoice's status can never drift out of sync with its real balance,
 * regardless of which client (web, mobile, retried request) recorded it.
 * Only touches sent/partial/paid invoices — draft and cancelled are untouched.
 */
async function recomputeInvoiceStatus(invoiceId) {
  const { rows } = await pool.query("SELECT id, status, grand_total_paise FROM invoices WHERE id = $1", [invoiceId]);
  const invoice = rows[0];
  if (!invoice || invoice.status === "draft" || invoice.status === "cancelled") return;

  const { rows: sums } = await pool.query(
    `SELECT
       COALESCE((SELECT SUM(amount_paise) FROM payments WHERE invoice_id = $1 AND status <> 'void'), 0) AS paid,
       COALESCE((SELECT SUM(amount_paise) FROM credit_notes WHERE invoice_id = $1 AND status = 'issued'), 0) AS credit,
       COALESCE((SELECT SUM(amount_paise) FROM debit_notes WHERE invoice_id = $1 AND status = 'issued'), 0) AS debit`,
    [invoiceId]
  );
  const { paid, credit, debit } = sums[0];
  const outstanding = BigInt(invoice.grand_total_paise) - BigInt(paid) - BigInt(credit) + BigInt(debit);

  const nextStatus = outstanding <= 0n ? "paid" : (BigInt(paid) + BigInt(credit) > 0n ? "partial" : "sent");
  if (nextStatus !== invoice.status) {
    await pool.query("UPDATE invoices SET status = $1 WHERE id = $2", [nextStatus, invoiceId]);
  }
}

/* -------------------------------- payments -------------------------------- */

const paymentSchema = z.object({
  companyId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  amount: z.union([z.number(), z.string()]).refine((v) => Number.isFinite(Number(v)) && Number(v) > 0, { message: "Amount must be positive." }),
  method: z.string().optional().nullable(),
  reference: z.string().optional().nullable(),
  paidOn: z.string().optional().nullable(),
});

const paymentToApi = (r) => ({
  id: r.id, companyId: r.company_id, invoiceId: r.invoice_id,
  amount: fromPaise(BigInt(r.amount_paise)), method: r.method, reference: r.reference,
  paidOn: r.paid_on, status: r.status, createdAt: r.created_at,
});

router.get("/payments", requireCompanyOwnership, async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM payments WHERE company_id = $1 ORDER BY paid_on DESC", [req.companyId]);
    res.json({ payments: rows.map(paymentToApi) });
  } catch (err) { next(err); }
});

router.post("/payments", requireCompanyOwnership, async (req, res, next) => {
  try {
    const body = paymentSchema.parse(req.body);
    if (!(await assertInvoiceOwned(req.companyId, body.invoiceId))) return res.status(404).json({ error: "Invoice not found." });
    const { rows } = await pool.query(
      `INSERT INTO payments (company_id, invoice_id, amount_paise, method, reference, paid_on)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6, CURRENT_DATE)) RETURNING *`,
      [req.companyId, body.invoiceId, toPaise(body.amount).toString(), body.method || null, body.reference || null, body.paidOn || null]
    );
    await recomputeInvoiceStatus(body.invoiceId);
    res.status(201).json({ payment: paymentToApi(rows[0]) });
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: err.issues[0]?.message || "Invalid input." });
    next(err);
  }
});

router.post("/payments/:id/void", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE payments p SET status = 'void' FROM companies co
       WHERE p.id = $1 AND p.company_id = co.id AND co.user_id = $2 RETURNING p.*`,
      [req.params.id, req.userId]
    );
    if (!rows.length) return res.status(404).json({ error: "Payment not found." });
    await recomputeInvoiceStatus(rows[0].invoice_id);
    res.json({ payment: paymentToApi(rows[0]) });
  } catch (err) { next(err); }
});

/* ------------------------------ credit / debit notes ------------------------------ */

function noteSchema() {
  return z.object({
    companyId: z.string().uuid(),
    invoiceId: z.string().uuid(),
    noteNumber: z.string().trim().min(1),
    amount: z.union([z.number(), z.string()]).refine((v) => Number.isFinite(Number(v)) && Number(v) > 0, { message: "Amount must be positive." }),
    reason: z.string().optional().nullable(),
    issuedOn: z.string().optional().nullable(),
  });
}
const noteToApi = (r) => ({
  id: r.id, companyId: r.company_id, invoiceId: r.invoice_id, noteNumber: r.note_number,
  amount: fromPaise(BigInt(r.amount_paise)), reason: r.reason, status: r.status,
  issuedOn: r.issued_on, createdAt: r.created_at,
});

for (const kind of ["credit", "debit"]) {
  const table = `${kind}_notes`;
  router.get(`/${kind}-notes`, requireCompanyOwnership, async (req, res, next) => {
    try {
      const { rows } = await pool.query(`SELECT * FROM ${table} WHERE company_id = $1 ORDER BY issued_on DESC`, [req.companyId]);
      res.json({ [`${kind}Notes`]: rows.map(noteToApi) });
    } catch (err) { next(err); }
  });

  router.post(`/${kind}-notes`, requireCompanyOwnership, async (req, res, next) => {
    try {
      const body = noteSchema().parse(req.body);
      if (!(await assertInvoiceOwned(req.companyId, body.invoiceId))) return res.status(404).json({ error: "Invoice not found." });
      const { rows } = await pool.query(
        `INSERT INTO ${table} (company_id, invoice_id, note_number, amount_paise, reason, issued_on)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6, CURRENT_DATE)) RETURNING *`,
        [req.companyId, body.invoiceId, body.noteNumber, toPaise(body.amount).toString(), body.reason || null, body.issuedOn || null]
      );
      await recomputeInvoiceStatus(body.invoiceId);
      res.status(201).json({ [kind === "credit" ? "creditNote" : "debitNote"]: noteToApi(rows[0]) });
    } catch (err) {
      if (err.name === "ZodError") return res.status(400).json({ error: err.issues[0]?.message || "Invalid input." });
      next(err);
    }
  });
}

/* --------------------------------- audit logs (read-only) --------------------------------- */

router.get("/audit-logs", requireCompanyOwnership, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM audit_logs WHERE company_id = $1 ORDER BY created_at DESC LIMIT 500",
      [req.companyId]
    );
    res.json({
      auditLogs: rows.map((r) => ({
        id: r.id, entityType: r.entity_type, entityId: r.entity_id, action: r.action,
        oldValue: r.old_value, newValue: r.new_value, reason: r.reason, createdAt: r.created_at,
      })),
    });
  } catch (err) { next(err); }
});

export default router;
