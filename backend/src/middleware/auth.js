import { verifyAccessToken } from "../utils/jwt.js";
import { pool } from "../db/pool.js";

/** Requires a valid Bearer access token; attaches req.userId. */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Authentication required." });
  try {
    const payload = verifyAccessToken(token);
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session. Please log in again." });
  }
}

/**
 * Loads the company referenced by :companyId (or req.body.companyId) and
 * verifies it belongs to the authenticated user. This is the central check
 * that prevents one user from reaching another user's data by guessing IDs.
 */
export async function requireCompanyOwnership(req, res, next) {
  const companyId = req.params.companyId || req.body.companyId || req.query.companyId;
  if (!companyId) return res.status(400).json({ error: "companyId is required." });
  try {
    const { rows } = await pool.query("SELECT id FROM companies WHERE id = $1 AND user_id = $2", [companyId, req.userId]);
    if (!rows.length) return res.status(404).json({ error: "Company not found." });
    req.companyId = companyId;
    next();
  } catch (err) {
    next(err);
  }
}
