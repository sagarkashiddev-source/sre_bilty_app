import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env and configure it.");
}

// Render/managed Postgres providers require SSL in production; local dev does not.
const useSSL = /render\.com|neon\.tech|supabase\.co|sslmode=require/.test(process.env.DATABASE_URL) ||
  process.env.PGSSL === "true";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
  max: Number(process.env.PG_POOL_MAX || 10),
});

pool.on("error", (err) => {
  // Idle client errors should never crash the process.
  console.error("Unexpected PostgreSQL pool error", err);
});

/** Runs `fn` inside a transaction, committing on success and rolling back on error. */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
