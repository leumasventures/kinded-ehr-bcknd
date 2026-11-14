import "dotenv/config";

const num = (v, d) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);

export const config = {
  env: process.env.NODE_ENV ?? "development",
  port: num(process.env.PORT, 4000),
  db: {
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: num(process.env.DB_PORT, 3306),
    user: process.env.DB_USER ?? "root",
    password: process.env.DB_PASSWORD ?? "",
    database: process.env.DB_NAME ?? "hms",
    ssl: process.env.DB_SSL === "true",
  },
  jwtSecret: process.env.JWT_SECRET ?? "",
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:5173")
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

/** Refuses to start with a missing or weak signing secret: a guessable secret lets anyone forge a login. */
export function assertConfig() {
  if (config.jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must be set to a random string of at least 32 characters.");
  }
}
