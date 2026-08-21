import jwt from "jsonwebtoken";

const ACCESS_TTL = "15m";
const REFRESH_TTL_DAYS = 30;

export function signAccessToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: ACCESS_TTL });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

export function newRefreshTokenValue() {
  // Opaque random token; only its hash is stored server-side.
  return crypto.randomUUID() + "." + crypto.randomUUID();
}

export const REFRESH_TOKEN_MAX_AGE_MS = REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000;

// Node 18+ has global crypto; import lazily for clarity in older runtimes.
import crypto from "node:crypto";

export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}
