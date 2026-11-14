import { query, sqlNow } from "../config/database.js";
import { ADMIN_ROLE_ID, normalizePermissions } from "../config/permissions.js";
import { bad, conflict, notFound, wrap } from "../utils/errors.js";
import { audit } from "../services/audit.service.js";
import { hashPassword, temporaryPassword } from "../services/password.service.js";
import { revokeUserTokens } from "../services/token.service.js";
import { activeAdmins, emailTaken, getStaffRow, listStaff, newUserId, roleExists, staffOut } from "../services/user.service.js";

export const list = wrap(async (_req, res) => res.json({ users: await listStaff() }));

export const create = wrap(async (req, res) => {
  const d = req.body;
  if (!(await roleExists(d.roleId))) throw bad("That role doesn't exist.");
  if (await emailTaken(d.email)) throw conflict("A user with this email already exists.");
  const id = newUserId();
  const temp = temporaryPassword();
  await query("INSERT INTO users (id, name, email, phone, role_id, permissions, active, must_change_password, password_hash) VALUES (?,?,?,?,?,?,?,1,?)", [id, d.name, d.email, d.phone || null, d.roleId, d.permissions ? JSON.stringify(normalizePermissions(d.permissions)) : null, d.active === false ? 0 : 1, await hashPassword(temp)]);
  await audit(req, { action: "Create", module: "Users", summary: `Created user ${d.name} (${d.email}) with role ${d.roleId}${d.permissions ? " and personal privileges" : ""}` });
  // The only time the temporary password exists in readable form.
  res.status(201).json({ user: staffOut(await getStaffRow(id)), temporaryPassword: temp });
});

export const update = wrap(async (req, res) => {
  const d = req.body;
  const row = await getStaffRow(req.params.id);
  if (!row) throw notFound("User not found.");
  const wasAdmin = row.role_id === ADMIN_ROLE_ID && row.active;
  const willBeAdmin = (d.roleId ?? row.role_id) === ADMIN_ROLE_ID && (d.active ?? !!row.active);
  if (wasAdmin && !willBeAdmin && (await activeAdmins(row.id)) === 0) throw conflict("This is the last active administrator. Make someone else an administrator first.");
  if (row.id === req.user.id && d.active === false) throw conflict("You can't deactivate your own account.");
  if (d.roleId && !(await roleExists(d.roleId))) throw bad("That role doesn't exist.");
  if (d.email && d.email !== row.email && (await emailTaken(d.email, row.id))) throw conflict("A user with this email already exists.");

  const sets = [];
  const vals = [];
  const set = (col, v) => (sets.push(`${col} = ?`), vals.push(v));
  if (d.name !== undefined) set("name", d.name);
  if (d.email !== undefined) set("email", d.email);
  if (d.phone !== undefined) set("phone", d.phone || null);
  if (d.roleId !== undefined) set("role_id", d.roleId);
  if (d.active !== undefined) set("active", d.active ? 1 : 0);
  if (d.permissions !== undefined) set("permissions", d.permissions ? JSON.stringify(normalizePermissions(d.permissions)) : null);
  if (sets.length === 0) return res.json({ user: staffOut(row) });
  await query(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, [...vals, row.id]);
  // Deactivating, or changing the sign-in email, ends their sessions.
  if (d.active === false || (d.email && d.email !== row.email)) await revokeUserTokens(row.id);
  await audit(req, { action: d.active === false ? "Security" : "Update", module: "Users", summary: `${d.active === false ? "Deactivated" : d.active === true && !row.active ? "Reactivated" : "Updated"} user ${row.name} (${row.email}); changed: ${Object.keys(d).join(", ")}` });
  res.json({ user: staffOut(await getStaffRow(row.id)) });
});

export const resetPassword = wrap(async (req, res) => {
  const row = await getStaffRow(req.params.id);
  if (!row) throw notFound("User not found.");
  const temp = temporaryPassword();
  await query("UPDATE users SET password_hash = ?, must_change_password = 1, failed_logins = 0, locked_until = NULL WHERE id = ?", [await hashPassword(temp), row.id]);
  await revokeUserTokens(row.id);
  await audit(req, { action: "Security", module: "Users", summary: `Reset the password of ${row.name} (${row.email}); they must choose a new one at next sign-in` });
  res.json({ temporaryPassword: temp });
});

export const remove = wrap(async (req, res) => {
  const row = await getStaffRow(req.params.id);
  if (!row) throw notFound("User not found.");
  if (row.id === req.user.id) throw conflict("You can't delete your own account.");
  // Anyone who has signed in has left a trail in the audit log. Keep the account so that trail still points at someone.
  if (row.last_login) throw conflict("This person has already signed in, so their account is kept for the record. Deactivate it instead.");
  if (row.role_id === ADMIN_ROLE_ID && row.active && (await activeAdmins(row.id)) === 0) throw conflict("This is the last active administrator.");
  await query("DELETE FROM users WHERE id = ?", [row.id]);
  await audit(req, { action: "Delete", module: "Users", summary: `Deleted user ${row.name} (${row.email}), who had never signed in` });
  res.json({ ok: true });
});
