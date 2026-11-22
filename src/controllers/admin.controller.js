import { query } from "../config/database.js";
import { ADMIN_ROLE_ID } from "../config/permissions.js";
import { bad, notFound, wrap } from "../utils/errors.js";
import { audit } from "../services/audit.service.js";
import { revokeUserTokens } from "../services/token.service.js";
import { getStaffRow } from "../services/user.service.js";

// Account-security and system-health tools for administrators. Creating, editing and deleting users lives in
// users.controller.js, roles in role.controller.js and the audit trail in audit.controller.js. Nothing here
// reads or writes clinical data. Mount these routes behind an administrator-only guard.

const n = (v) => Number(v ?? 0);

const brief = (r) => ({
  id: r.id,
  name: r.name,
  email: r.email,
  roleId: r.role_id,
  active: !!r.active,
  lastLogin: r.last_login ?? null,
  failedLogins: n(r.failed_logins),
  lockedUntil: r.locked_until ?? null,
});

const BRIEF_COLS = "id, name, email, role_id, active, last_login, failed_logins, locked_until";

export const overview = wrap(async (_req, res) => {
  const [counts] = await query(
    `SELECT COUNT(*) AS total,
            SUM(active = 1) AS active,
            SUM(active = 0) AS inactive,
            SUM(locked_until IS NOT NULL AND locked_until > NOW()) AS locked,
            SUM(must_change_password = 1) AS must_change,
            SUM(last_login IS NULL) AS never_signed_in
       FROM users`
  );
  const byRole = await query("SELECT role_id, COUNT(*) AS total, SUM(active = 1) AS active FROM users GROUP BY role_id ORDER BY role_id");
  const [admins] = await query("SELECT COUNT(*) AS total FROM users WHERE role_id = ? AND active = 1", [ADMIN_ROLE_ID]);
  const [db] = await query("SELECT VERSION() AS version");

  res.json({
    users: {
      total: n(counts.total),
      active: n(counts.active),
      inactive: n(counts.inactive),
      locked: n(counts.locked),
      mustChangePassword: n(counts.must_change),
      neverSignedIn: n(counts.never_signed_in),
      activeAdministrators: n(admins.total),
      byRole: byRole.map((r) => ({ roleId: r.role_id, total: n(r.total), active: n(r.active) })),
    },
    system: { database: db.version, node: process.version, uptimeSeconds: Math.round(process.uptime()) },
  });
});

export const lockedAccounts = wrap(async (_req, res) => {
  const rows = await query(`SELECT ${BRIEF_COLS} FROM users WHERE locked_until IS NOT NULL AND locked_until > NOW() ORDER BY locked_until DESC`);
  res.json({ users: rows.map(brief) });
});

// Active accounts nobody has used lately are a standing risk. ?days=90 (1 to 3650).
export const staleAccounts = wrap(async (req, res) => {
  const days = req.query.days === undefined ? 90 : Number(req.query.days);
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw bad("Days must be a whole number from 1 to 3650.");
  const rows = await query(
    `SELECT ${BRIEF_COLS} FROM users
      WHERE active = 1 AND (last_login IS NULL OR last_login < DATE_SUB(NOW(), INTERVAL ? DAY))
      ORDER BY last_login IS NULL DESC, last_login`,
    [days]
  );
  res.json({ days, users: rows.map(brief) });
});

export const unlock = wrap(async (req, res) => {
  const row = await getStaffRow(req.params.id);
  if (!row) throw notFound("User not found.");
  await query("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?", [row.id]);
  await audit(req, { action: "Security", module: "Admin", summary: `Unlocked the account of ${row.name} (${row.email})` });
  const [after] = await query(`SELECT ${BRIEF_COLS} FROM users WHERE id = ?`, [row.id]);
  res.json({ user: brief(after) });
});

// Ends every session for one person without changing their password, e.g. a lost phone or an unattended workstation.
export const signOut = wrap(async (req, res) => {
  const row = await getStaffRow(req.params.id);
  if (!row) throw notFound("User not found.");
  await revokeUserTokens(row.id);
  await audit(req, { action: "Security", module: "Admin", summary: `Signed ${row.name} (${row.email}) out of every session${row.id === req.user.id ? " (their own)" : ""}` });
  res.json({ ok: true });
});