import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireAuth, requireCompanyOwnership } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

const templateSchema = z.object({
  companyId: z.string().uuid(),
  customerId: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(1),
  cadence: z.string().optional().nullable(),
  nextRunOn: z.string().optional().nullable(),
  payload: z.record(z.any()),
});

const toApi = (r) => ({
  id: r.id, companyId: r.company_id, customerId: r.customer_id, name: r.name,
  cadence: r.cadence, nextRunOn: r.next_run_on, payload: r.payload,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

router.get("/", requireCompanyOwnership, async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM recurring_templates WHERE company_id = $1 ORDER BY name ASC", [req.companyId]);
    res.json({ templates: rows.map(toApi) });
  } catch (err) { next(err); }
});

router.post("/", requireCompanyOwnership, async (req, res, next) => {
  try {
    const body = templateSchema.parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO recurring_templates (company_id, customer_id, name, cadence, next_run_on, payload)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.companyId, body.customerId || null, body.name, body.cadence || "monthly", body.nextRunOn || null, JSON.stringify(body.payload)]
    );
    res.status(201).json({ template: toApi(rows[0]) });
  } catch (err) {
    if (err.name === "ZodError") return res.status(400).json({ error: err.issues[0]?.message || "Invalid input." });
    next(err);
  }
});

router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM recurring_templates t USING companies co
       WHERE t.id = $1 AND t.company_id = co.id AND co.user_id = $2`,
      [req.params.id, req.userId]
    );
    if (!rowCount) return res.status(404).json({ error: "Template not found." });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
