import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireAuth, requireCompanyOwnership } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

const customerSchema = z.object({
  companyId: z.string().uuid(),
  companyIds: z.array(z.string().uuid()).min(1, "Select at least one company.").optional(),
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
    companyId: row.company_id, // primary/home company, kept for backward compatibility
    companyIds: row.company_ids || [row.company_id], // every company that can bill this customer
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

// Every query below joins customer_companies (not just customers.company_id)
// so a customer linked to multiple companies is returned/matched correctly
// for any of them, and aggregates the full membership list as company_ids.
const SELECT_WITH_COMPANIES = `
  SELECT c.*, COALESCE(array_agg(cc.company_id) FILTER (WHERE cc.company_id IS NOT NULL), ARRAY[c.company_id]) AS company_ids
  FROM customers c
  LEFT JOIN customer_companies cc ON cc.customer_id = c.id
`;

// GET /api/customers?companyId=...
router.get("/", requireCompanyOwnership, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `${SELECT_WITH_COMPANIES}
       WHERE c.id IN (SELECT customer_id FROM customer_companies WHERE company_id = $1)
       GROUP BY c.id ORDER BY c.name ASC`,
      [req.companyId]
    );
    res.json({ customers: rows.map(toApi) });
  } catch (err) { next(err); }
});

router.post("/", requireCompanyOwnership, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const body = customerSchema.parse(req.body);
    const companyIds = [...new Set([req.companyId, ...(body.companyIds || [])])];
    // Every company in the list must actually belong to this user - requireCompanyOwnership
    // only verified req.companyId (the one in the query string), not any extras in the body.
    if (companyIds.length > 1) {
      const owns = await client.query("SELECT id FROM companies WHERE id = ANY($1) AND user_id = $2", [companyIds, req.userId]);
      if (owns.rows.length !== companyIds.length) return res.status(404).json({ error: "One of the selected companies was not found." });
    }
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO customers (company_id, name, gstin, billing_address, shipping_address, phone, email, state, state_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.companyId, body.name, body.gstin || null, body.billingAddress || null, body.shippingAddress || null,
       body.phone || null, body.email || null, body.state || null, body.stateCode || null]
    );
    const customer = rows[0];
    for (const companyId of companyIds) {
      await client.query("INSERT INTO customer_companies (customer_id, company_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [customer.id, companyId]);
    }
    await client.query("COMMIT");
    res.status(201).json({ customer: toApi({ ...customer, company_ids: companyIds }) });
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.name === "ZodError") return res.status(400).json({ error: err.issues[0]?.message || "Invalid input." });
    next(err);
  } finally {
    client.release();
  }
});

async function loadOwnedCustomer(req, res, next) {
  const { rows } = await pool.query(
    `SELECT DISTINCT c.* FROM customers c
     JOIN customer_companies cc ON cc.customer_id = c.id
     JOIN companies co ON co.id = cc.company_id
     WHERE c.id = $1 AND co.user_id = $2`,
    [req.params.id, req.userId]
  );
  if (!rows.length) return res.status(404).json({ error: "Customer not found." });
  req.customer = rows[0];
  next();
}

router.put("/:id", loadOwnedCustomer, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const body = customerSchema.partial().parse(req.body);
    // Every target company must belong to this user.
    const targetCompanyIds = body.companyIds || (body.companyId ? [body.companyId] : null);
    if (targetCompanyIds) {
      const owns = await client.query("SELECT id FROM companies WHERE id = ANY($1) AND user_id = $2", [targetCompanyIds, req.userId]);
      if (owns.rows.length !== targetCompanyIds.length) return res.status(404).json({ error: "One of the selected companies was not found." });
    }
    await client.query("BEGIN");
    const { rows } = await client.query(
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
    if (targetCompanyIds) {
      // Replace the full membership list with exactly what was sent, rather
      // than only ever adding - so removing a company from the list actually
      // takes it off that company's customer dropdown too.
      await client.query("DELETE FROM customer_companies WHERE customer_id = $1", [req.params.id]);
      for (const companyId of targetCompanyIds) {
        await client.query("INSERT INTO customer_companies (customer_id, company_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [req.params.id, companyId]);
      }
    }
    await client.query("COMMIT");
    res.json({ customer: toApi({ ...rows[0], company_ids: targetCompanyIds || undefined }) });
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.name === "ZodError") return res.status(400).json({ error: err.issues[0]?.message || "Invalid input." });
    next(err);
  } finally {
    client.release();
  }
});

router.delete("/:id", loadOwnedCustomer, async (req, res, next) => {
  try {
    await pool.query("DELETE FROM customers WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
