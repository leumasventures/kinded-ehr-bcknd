import mysql from "mysql2/promise";
import { config } from "./environment.js";

// Dates come back as plain strings ("2026-11-10", "2026-11-10 14:03:22.123") and are stored in UTC,
// so nothing is shifted by the server's or the database's time zone.
export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  ssl: config.db.ssl ? { rejectUnauthorized: true } : undefined,
  waitForConnections: true,
  connectionLimit: 10,
  timezone: "Z",
  dateStrings: true,
  charset: "utf8mb4",
});

export const query = async (sql, params = []) => (await pool.query(sql, params))[0];

/** Runs fn inside one transaction. Anything thrown rolls everything back. */
export async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    try {
      await conn.rollback();
    } catch {
      /* connection already gone */
    }
    throw e;
  } finally {
    conn.release();
  }
}

/** JSON columns arrive as objects on MySQL and as text on MariaDB. */
export const fromJson = (v, fallback = null) => {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return fallback;
    }
  }
  return v;
};

/** "2026-11-10 14:03:22.123" in UTC, the format DATETIME(3) columns use. */
export const sqlNow = (d = new Date()) => d.toISOString().slice(0, 23).replace("T", " ");
