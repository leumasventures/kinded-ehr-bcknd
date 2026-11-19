import jwt from "jsonwebtoken";
import { createHash, randomBytes } from "node:crypto";
import { config } from "../config/environment.js";
import { query, sqlNow } from "../config/database.js";
import { ApiError } from "../utils/errors.js";
import { publicUser } from "./user.service.js";

export const sha256 = (s) => createHash("sha256").update(s).digest("hex");
export const newRefreshToken = () => randomBytes(48).toString("base64url");

export const signAccess = (userId) => jwt.sign({ sub: userId }, config.jwtSecret, { algorithm: "HS256", expiresIn: `${config.accessMinutes}m` });

/** Returns the user id inside a valid access token, or throws a 401 the web app knows how to handle. */
export function verifyAccess(token) {
  try {
    return String(jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] }).sub);
  } catch {
    throw new ApiError(401, "Your session has ended. Sign in again.", { code: "token_expired" });
  }
}

/** Starts a session: a short-lived access token plus a one-time refresh token. Only the refresh token's hash is stored. */
export async function issueTokens(user, req, family = randomBytes(16).toString("hex")) {
  const refresh = newRefreshToken();
  const expires = new Date(Date.now() + config.refreshDays * 86_400_000);
  await query("INSERT INTO refresh_tokens (user_id, token_hash, family, expires_at, user_agent) VALUES (?,?,?,?,?)", [user.id, sha256(refresh), family, sqlNow(expires), (req.get("user-agent") ?? "").slice(0, 255)]);
  return { accessToken: signAccess(user.id), refreshToken: refresh, expiresIn: config.accessMinutes * 60, user: publicUser(user) };
}

export const findRefreshToken = async (raw) => (await query("SELECT * FROM refresh_tokens WHERE token_hash = ?", [sha256(raw)]))[0];
export const revokeToken = (id) => query("UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?", [sqlNow(), id]);
export const revokeFamily = (family) => query("UPDATE refresh_tokens SET revoked_at = ? WHERE family = ? AND revoked_at IS NULL", [sqlNow(), family]);
export const revokeUserTokens = (userId) => query("UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", [sqlNow(), userId]);
export const revokeOwnToken = (raw, userId) => query("UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND user_id = ? AND revoked_at IS NULL", [sqlNow(), sha256(raw), userId]);
