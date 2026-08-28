import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireAuth, requireCompanyOwnership } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

const customerSchema = z.object({
  companyId: z.string().uuid(),
  name: z.string().trim().min(1, "Customer name is required."),
  gstin: z.string().trim().optional().nullable(),
  billingAddress: z.string().trim().optional().nullable(),
  shippingAddress: z.string().trim().optional().nullable(),
  phone: z.string().trim().optional().nullable(),
  email: z.string().trim().optional().nullable(),
  state: z.string().trim().optional().nullable(),
  stateCode: z.string().trim().optional().nullable(),
});

function toApi(row) {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    gstin: row.gstin,
    billingAddress: row.billing_address,
    shippingAddress: row.shipping_address,
    phone: row.phone,
    email: row.email,
    state: row.state,
    stateCode: row.state_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/customers?companyId=...
router.get("/", requireCompanyOwnership, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM customers WHERE company_id = $1 ORDER BY name ASC",
      [req.companyId]
    );
    res.json({ customers: rows.map(toApi) });
  } catch (err) { next(err); }
});

router.post("/", requireCompanyOwnership, async (req, res, next) => {
  try {
    const body = customerSchema.parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO customers (company_id, name, gstin, billing_address, shipping_address, phone, email, state, state_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.companyId, body.name, body.gstin || null, body.billingAddress || null, body.shippingAddress || null,
       body.phone || null, body.email || null, body.state || null, body.stateCode || null]
    );
    res.status(201).json({ customer: toApi(rows[0]) });
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: err.issues[0]?.message || "Invalid input." });
    next(err);
  }
});

async function loadOwnedCustomer(req, res, next) {
  const { rows } = await pool.query(
    `SELECT c.* FROM customers c JOIN companies co ON co.id = c.company_id
     WHERE c.id = $1 AND co.user_id = $2`,
    [req.params.id, req.userId]
  );
  if (!rows.length) return res.status(404).json({ error: "Customer not found." });
  req.customer = rows[0];
  next();
}

router.put("/:id", loadOwnedCustomer, async (req, res, next) => {
  try {
    const body = customerSchema.partial().parse(req.body);
    // If reassigning to a different company, that company must also belong
    // to this user - loadOwnedCustomer only verified the CURRENT company.
    if (body.companyId) {
      const owns = await pool.query("SELECT id FROM companies WHERE id = $1 AND user_id = $2", [body.companyId, req.userId]);
      if (!owns.rows.length) return res.status(404).json({ error: "Target company not found." });
    }
    const { rows } = await pool.query(
      `UPDATE customers SET
         company_id = COALESCE($1, company_id),
         name = COALESCE($2, name), gstin = COALESCE($3, gstin),
         billing_address = COALESCE($4, billing_address), shipping_address = COALESCE($5, shipping_address),
         phone = COALESCE($6, phone), email = COALESCE($7, email),
         state = COALESCE($8, state), state_code = COALESCE($9, state_code)
       WHERE id = $10 RETURNING *`,
      [body.companyId, body.name, body.gstin, body.billingAddress, body.shippingAddress, body.phone, body.email,
       body.state, body.stateCode, req.params.id]
    );
    res.json({ customer: toApi(rows[0]) });
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: err.issues[0]?.message || "Invalid input." });
    next(err);
  }
});

router.delete("/:id", loadOwnedCustomer, async (req, res, next) => {
  try {
    await pool.query("DELETE FROM customers WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
