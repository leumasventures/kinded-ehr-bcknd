import { query, fromJson, sqlNow } from "../config/database.js";
import { ADMIN_ROLE_ID, effectivePermissions } from "../config/permissions.js";

const SELECT_USER = `SELECT u.*, r.name AS role_name, r.permissions AS role_permissions
  FROM users u JOIN roles r ON r.id = u.role_id`;

/** The shape the web app receives after sign-in: no hash, and permissions already resolved (personal privileges replace the role's). */
export const publicUser = (row) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  phone: row.phone ?? undefined,
  roleId: row.role_id,
  roleName: row.role_name,
  isAdmin: row.role_id === ADMIN_ROLE_ID,
  permissions: effectivePermissions(fromJson(row.permissions), fromJson(row.role_permissions)),
  mustChangePassword: !!row.must_change_password,
});

export const findUserById = async (id) => (await query(`${SELECT_USER} WHERE u.id = ?`, [id]))[0];
export const findUserByEmail = async (email) => (await query(`${SELECT_USER} WHERE u.email = ?`, [email]))[0];

/** The shape the administrator's staff list receives. */
export const staffOut = (r) => ({
  id: r.id,
  name: r.name,
  email: r.email,
  phone: r.phone ?? undefined,
  roleId: r.role_id,
  active: !!r.active,
  mustChangePassword: !!r.must_change_password,
  lastLogin: r.last_login ?? null,
  createdAt: r.created_at,
  permissions: fromJson(r.permissions) ?? undefined,
  locked: !!(r.locked_until && r.locked_until > sqlNow()),
});

export const listStaff = async () => (await query("SELECT * FROM users ORDER BY name")).map(staffOut);
export const getStaffRow = async (id) => (await query("SELECT * FROM users WHERE id = ?", [id]))[0];
export const emailTaken = async (email, exceptId = "") => (await query("SELECT id FROM users WHERE email = ? AND id <> ?", [email, exceptId])).length > 0;
export const roleExists = async (id) => (await query("SELECT id FROM roles WHERE id = ?", [id])).length > 0;
export const activeAdmins = async (excludeId = "") => Number((await query("SELECT COUNT(*) AS n FROM users WHERE role_id = ? AND active = 1 AND id <> ?", [ADMIN_ROLE_ID, excludeId]))[0].n);
export const newUserId = () => `u-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
