import { query } from "../config/database.js";
import { bad, notFound, wrap } from "../utils/errors.js";
import { audit } from "../services/audit.service.js";
import { hashPassword, checkPassword } from "../services/password.service.js";
import { revokeUserTokens } from "../services/token.service.js";
import { getStaffRow, staffOut } from "../services/user.service.js";

// The signed-in person managing their own account. Email, role and privileges are not editable here:
// those stay with administrators (users.controller.js), so nobody can promote themselves.

const MIN_PASSWORD = 10;
const MAX_PASSWORD = 128;

async function mine(req) {
  const row = await getStaffRow(req.user.id);
  if (!row) throw notFound("Account not found.");
  return row;
}

export const me = wrap(async (req, res) => {
  res.json({ user: staffOut(await mine(req)) });
});

export const updateProfile = wrap(async (req, res) => {
  const d = req.body;
  const row = await mine(req);
  const sets = [];
  const vals = [];
  const changed = [];
  if (d.name !== undefined && d.name !== row.name) (sets.push("name = ?"), vals.push(d.name), changed.push("name"));
  if (d.phone !== undefined && (d.phone || null) !== (row.phone ?? null)) (sets.push("phone = ?"), vals.push(d.phone || null), changed.push("phone"));
  if (sets.length === 0) return res.json({ user: staffOut(row) });
  await query(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, [...vals, row.id]);
  // Only the field names are logged, never the values.
  await audit(req, { action: "Update", module: "Account", summary: `${row.name} (${row.email}) updated their own profile; changed: ${changed.join(", ")}` });
  res.json({ user: staffOut(await getStaffRow(row.id)) });
});

export const changePassword = wrap(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const row = await mine(req);
  const [secret] = await query("SELECT password_hash FROM users WHERE id = ?", [row.id]);

  if (!(await checkPassword(currentPassword, secret.password_hash))) {
    await audit(req, { action: "Security", module: "Account", summary: `${row.name} (${row.email}) gave the wrong current password while trying to change it` });
    throw bad("Your current password isn't right.");
  }
  if (newPassword.length < MIN_PASSWORD) throw bad(`Choose a password of at least ${MIN_PASSWORD} characters.`);
  if (newPassword.length > MAX_PASSWORD) throw bad(`Choose a password of at most ${MAX_PASSWORD} characters.`);
  if (newPassword === currentPassword) throw bad("Choose a password you haven't been using.");
  if (newPassword.toLowerCase() === String(row.email).toLowerCase()) throw bad("Your password can't be your email address.");

  await query("UPDATE users SET password_hash = ?, must_change_password = 0, failed_logins = 0, locked_until = NULL WHERE id = ?", [await hashPassword(newPassword), row.id]);
  // Ends every session, this one included, so a stolen token stops working. The app should send them to sign in again.
  await revokeUserTokens(row.id);
  await audit(req, { action: "Security", module: "Account", summary: `${row.name} (${row.email}) changed their own password` });
  res.json({ ok: true, signedOut: true });
});