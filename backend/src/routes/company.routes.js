import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

const companySchema = z.object({
  companyName: z.string().trim().min(1, "Company name is required."),
  gstin: z.string().trim().optional().nullable(),
  address: z.string().trim().optional().nullable(),
  phone: z.string().trim().optional().nullable(),
  email: z.string().trim().optional().nullable(),
  state: z.string().trim().optional().nullable(),
  stateCode: z.string().trim().optional().nullable(),
  logoStyle: z.string().trim().optional().nullable(),
  logoColor: z.string().trim().optional().nullable(),
  bankDetails: z.record(z.any()).optional().nullable(),
  terms: z.string().trim().optional().nullable(),
});

function toApi(row) {
  return {
    id: row.id,
    companyName: row.company_name,
    gstin: row.gstin,
    address: row.address,
    phone: row.phone,
    email: row.email,
    state: row.state,
    stateCode: row.state_code,
    logoStyle: row.logo_style,
    logoColor: row.logo_color,
    logoUrl: row.logo_url,
    bankDetails: row.bank_details,
    terms: row.terms,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

router.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM companies WHERE user_id = $1 ORDER BY created_at ASC", [req.userId]);
    res.json({ companies: rows.map(toApi) });
  } catch (err) { next(err); }
});

router.post("/", async (req, res, next) => {
  try {
    const body = companySchema.parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO companies (user_id, company_name, gstin, address, phone, email, state, state_code, logo_style, logo_color, bank_details, terms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [req.userId, body.companyName, body.gstin || null, body.address || null, body.phone || null, body.email || null,
       body.state || null, body.stateCode || null, body.logoStyle || "custom", body.logoColor || "#C6332B",
       JSON.stringify(body.bankDetails || {}), body.terms || null]
    );
    res.status(201).json({ company: toApi(rows[0]) });
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: err.issues[0]?.message || "Invalid input." });
    next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const body = companySchema.partial().parse(req.body);
    const existing = await pool.query("SELECT id FROM companies WHERE id = $1 AND user_id = $2", [req.params.id, req.userId]);
    if (!existing.rows.length) return res.status(404).json({ error: "Company not found." });

    const { rows } = await pool.query(
      `UPDATE companies SET
         company_name = COALESCE($1, company_name),
         gstin = COALESCE($2, gstin),
         address = COALESCE($3, address),
         phone = COALESCE($4, phone),
         email = COALESCE($5, email),
         state = COALESCE($6, state),
         state_code = COALESCE($7, state_code),
         logo_style = COALESCE($8, logo_style),
         logo_color = COALESCE($9, logo_color),
         bank_details = COALESCE($10, bank_details),
         terms = COALESCE($11, terms)
       WHERE id = $12 AND user_id = $13 RETURNING *`,
      [body.companyName, body.gstin, body.address, body.phone, body.email, body.state, body.stateCode,
       body.logoStyle, body.logoColor, body.bankDetails ? JSON.stringify(body.bankDetails) : null, body.terms,
       req.params.id, req.userId]
    );
    res.json({ company: toApi(rows[0]) });
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: err.issues[0]?.message || "Invalid input." });
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const existing = await pool.query("SELECT id FROM companies WHERE id = $1 AND user_id = $2", [req.params.id, req.userId]);
    if (!existing.rows.length) return res.status(404).json({ error: "Company not found." });

    // Never allow a company with real business history to be hard-deleted —
    // the previous version deleted unconditionally, which cascades to every
    // invoice, customer, product, and payment under it with no way back.
    // The frontend already offers "archive instead" for this case; the API
    // now enforces the same rule so it can't be bypassed by any client.
    const { rows: counts } = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM invoices WHERE company_id = $1) AS invoices,
         (SELECT COUNT(*) FROM customers WHERE company_id = $1) AS customers,
         (SELECT COUNT(*) FROM products WHERE company_id = $1) AS products`,
      [req.params.id]
    );
    const { invoices, customers, products } = counts[0];
    if (Number(invoices) > 0 || Number(customers) > 0 || Number(products) > 0) {
      return res.status(409).json({
        error: "This company has invoices, customers, or products on record and can't be permanently deleted. Archive it instead (set it inactive) to keep your history intact.",
        hasHistory: true,
      });
    }

    await pool.query("DELETE FROM companies WHERE id = $1 AND user_id = $2", [req.params.id, req.userId]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
