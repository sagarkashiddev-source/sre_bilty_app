import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireAuth, requireCompanyOwnership } from "../middleware/auth.js";
import { toPaise, fromPaise } from "../utils/money.js";

const router = Router();
router.use(requireAuth);

const productSchema = z.object({
  companyId: z.string().uuid(),
  name: z.string().trim().min(1, "Product name is required."),
  description: z.string().trim().optional().nullable(),
  hsnSac: z.string().trim().optional().nullable(),
  unit: z.string().trim().optional().nullable(),
  rate: z.union([z.number(), z.string()]).optional().nullable()
    .refine((v) => v == null || (Number.isFinite(Number(v)) && Number(v) >= 0), { message: "Rate must be non-negative." }),
  gstRate: z.number().min(0).max(100).optional().nullable(),
});

function toApi(row) {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    description: row.description,
    hsnSac: row.hsn_sac,
    unit: row.unit,
    rate: fromPaise(BigInt(row.rate_paise)),
    gstRate: Number(row.gst_rate),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

router.get("/", requireCompanyOwnership, async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM products WHERE company_id = $1 ORDER BY name ASC", [req.companyId]);
    res.json({ products: rows.map(toApi) });
  } catch (err) { next(err); }
});

router.post("/", requireCompanyOwnership, async (req, res, next) => {
  try {
    const body = productSchema.parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO products (company_id, name, description, hsn_sac, unit, rate_paise, gst_rate)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.companyId, body.name, body.description || null, body.hsnSac || null, body.unit || "Nos",
       toPaise(body.rate ?? 0).toString(), body.gstRate ?? 0]
    );
    res.status(201).json({ product: toApi(rows[0]) });
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: err.issues[0]?.message || "Invalid input." });
    next(err);
  }
});

async function loadOwnedProduct(req, res, next) {
  const { rows } = await pool.query(
    `SELECT p.* FROM products p JOIN companies co ON co.id = p.company_id
     WHERE p.id = $1 AND co.user_id = $2`,
    [req.params.id, req.userId]
  );
  if (!rows.length) return res.status(404).json({ error: "Product not found." });
  req.product = rows[0];
  next();
}

router.put("/:id", loadOwnedProduct, async (req, res, next) => {
  try {
    const body = productSchema.partial().parse(req.body);
    // Same fix as customers.routes.js: previously ignored companyId
    // entirely on update, so reassigning a product to a different company
    // via the edit form silently did nothing.
    if (body.companyId) {
      const owns = await pool.query("SELECT id FROM companies WHERE id = $1 AND user_id = $2", [body.companyId, req.userId]);
      if (!owns.rows.length) return res.status(404).json({ error: "Target company not found." });
    }
    const { rows } = await pool.query(
      `UPDATE products SET
         company_id = COALESCE($1, company_id),
         name = COALESCE($2, name), description = COALESCE($3, description),
         hsn_sac = COALESCE($4, hsn_sac), unit = COALESCE($5, unit),
         rate_paise = COALESCE($6, rate_paise), gst_rate = COALESCE($7, gst_rate)
       WHERE id = $8 RETURNING *`,
      [body.companyId, body.name, body.description, body.hsnSac, body.unit,
       body.rate !== undefined && body.rate !== null ? toPaise(body.rate).toString() : null,
       body.gstRate, req.params.id]
    );
    res.json({ product: toApi(rows[0]) });
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: err.issues[0]?.message || "Invalid input." });
    next(err);
  }
});

router.delete("/:id", loadOwnedProduct, async (req, res, next) => {
  try {
    await pool.query("DELETE FROM products WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
