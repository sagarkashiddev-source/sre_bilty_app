import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";

import authRoutes from "./routes/auth.routes.js";
import companyRoutes from "./routes/company.routes.js";
import customerRoutes from "./routes/customers.routes.js";
import productRoutes from "./routes/products.routes.js";
import invoiceRoutes from "./routes/invoices.routes.js";
import ledgerRoutes from "./routes/ledger.routes.js";
import templateRoutes from "./routes/templates.routes.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1); // Render sits behind a reverse proxy
  app.use(helmet());
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());

  const allowedOrigins = (process.env.CORS_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
  app.use(cors({
    origin(origin, callback) {
      // Allow same-origin/non-browser requests (no Origin header) and configured origins.
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  }));

  // Global rate limit as defense-in-depth; auth routes have their own tighter limiter.
  app.use(rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));

  app.get("/api/health", (req, res) => res.json({ ok: true }));

  app.use("/api/auth", authRoutes);
  app.use("/api/companies", companyRoutes);
  app.use("/api/customers", customerRoutes);
  app.use("/api/products", productRoutes);
  app.use("/api/invoices", invoiceRoutes);
  app.use("/api/templates", templateRoutes);
  app.use("/api", ledgerRoutes); // /api/payments, /api/credit-notes, /api/debit-notes, /api/audit-logs

  app.use("/api", notFound);
  app.use(errorHandler);

  return app;
}
