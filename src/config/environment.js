import "dotenv/config";

const num = (v, d) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);

export const config = {
  env: process.env.NODE_ENV ?? "development",
  port: num(process.env.PORT, 4000),
  db: {
    // No defaults on purpose: this server only ever talks to the hosted database named in .env, never to one on this computer.
    host: (process.env.DB_HOST ?? "").trim(),
    port: num(process.env.DB_PORT, 3306),
    user: process.env.DB_USER ?? "",
    password: process.env.DB_PASSWORD ?? "",
    database: process.env.DB_NAME ?? "",
    ssl: process.env.DB_SSL === "true",
  },
  jwtSecret: process.env.JWT_SECRET ?? "",
  corsOrigins: (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean),
  accessMinutes: num(process.env.ACCESS_TOKEN_MINUTES, 30),
  refreshDays: num(process.env.REFRESH_TOKEN_DAYS, 7),
  minPasswordLength: num(process.env.MIN_PASSWORD_LENGTH, 10),
  emergencyMinutes: num(process.env.EMERGENCY_MINUTES, 60),
  // Per address, per 15 minutes. A hospital shares one public address across all its staff, so these are generous;
  // the lockout on each account is what stops password guessing.
  loginRateLimit: num(process.env.LOGIN_RATE_LIMIT, 200),
  refreshRateLimit: num(process.env.REFRESH_RATE_LIMIT, 600),
  maxFailedLogins: 5,
  lockMinutes: 15,
};

const LOOPBACK = /^(localhost|127\.|0\.0\.0\.0|\[?::1\]?$)/i;

/** Refuses to run unless the database settings point at a real hosted database (never this computer). */
export function assertDatabaseConfig() {
  const missing = ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"].filter((k) => !String(process.env[k] ?? "").trim());
  if (missing.length) throw new Error(`Missing database settings in .env: ${missing.join(", ")}.`);
  if (LOOPBACK.test(config.db.host)) throw new Error("DB_HOST points at this computer. Use the host name of your hosted database (for Hostinger, the one shown under Remote MySQL).");
}

/** Refuses to start with a missing or weak signing secret (a guessable secret lets anyone forge a login), or without a database or a website allowed to call it. */
export function assertConfig() {
  assertDatabaseConfig();
  if (config.jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must be set to a random string of at least 32 characters.");
  }
  if (config.corsOrigins.length === 0) throw new Error("CORS_ORIGINS must list the address of your website, for example https://kindedcarehospital.com.");
}
