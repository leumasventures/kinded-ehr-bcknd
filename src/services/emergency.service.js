import { query, sqlNow } from "../config/database.js";

export const activeGrant = async (userId) =>
  (await query("SELECT * FROM emergency_grants WHERE user_id = ? AND ended_at IS NULL AND expires_at > ? ORDER BY id DESC LIMIT 1", [userId, sqlNow()]))[0];

export const grantOut = (g) => ({ startedAt: g.started_at, expiresAt: g.expires_at, reason: g.reason });

export const startGrant = (userId, reason, minutes) => {
  const now = new Date();
  return query("INSERT INTO emergency_grants (user_id, reason, started_at, expires_at) VALUES (?,?,?,?)", [userId, reason, sqlNow(now), sqlNow(new Date(now.getTime() + minutes * 60_000))]);
};

/** Ends every open grant for the person. Returns how many were open. */
export const endGrants = async (userId, reason) =>
  (await query("UPDATE emergency_grants SET ended_at = ?, ended_reason = ? WHERE user_id = ? AND ended_at IS NULL", [sqlNow(), reason, userId])).affectedRows;
