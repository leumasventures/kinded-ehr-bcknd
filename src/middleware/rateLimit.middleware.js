import rateLimit from "express-rate-limit";
import { config } from "../config/environment.js";

// Slows down password guessing from one address. The per-account lockout covers guessing spread across addresses.
const limiter = (limit) => rateLimit({ windowMs: 15 * 60_000, limit, standardHeaders: true, legacyHeaders: false, message: { error: "Too many sign-in attempts. Try again in a few minutes." } });
export const loginLimiter = limiter(config.loginRateLimit);
export const refreshLimiter = limiter(config.refreshRateLimit);

// Page-view and "reported by the app" entries. Generous, because a whole hospital shares one address.
export const clientAuditLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 6000, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests." } });
