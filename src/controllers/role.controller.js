import { query, fromJson } from "../config/database.js";
import { ACTIONS, ADMIN_ROLE_ID, MODULES, normalizePermissions } from "../config/permissions.js";
import { conflict, forbidden, notFound, wrap } from "../utils/errors.js";
import { audit } from "../services/audit.service.js";

const roleOut = (r, withPerms) => ({ id: r.id, name: r.name, description: r.description, isSystem: !!r.is_system, ...(withPerms ? { permissions: normalizePermissions(fromJson(r.permissions)) } : {}) });
const getRole = async (id) => (await query("SELECT * FROM roles WHERE id = ?", [id]))[0];

// Everyone signed in can see role names (the app shows them next to people). Only administrators see what a role may do.
export const list = wrap(async (req, res) => res.json({ roles: (await query("SELECT * FROM roles ORDER BY name")).map((r) => roleOut(r, req.user.isAdmin)) }));

export const create = wrap(async (req, res) => {
  const d = req.body;
  if ((await query("SELECT id FROM roles WHERE LOWER(name) = LOWER(?)", [d.name])).length) throw conflict("A role with this name already exists.");
  const id = `r-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  await query("INSERT INTO roles (id, name, description, permissions) VALUES (?,?,?,?)", [id, d.name, d.description, JSON.stringify(normalizePermissions(d.permissions))]);
  await audit(req, { action: "Create", module: "Roles", summary: `Created role ${d.name}` });
  res.status(201).json({ role: roleOut(await getRole(id), true) });
});

export const update = wrap(async (req, res) => {
  const d = req.body;
  const row = await getRole(req.params.id);
  if (!row) throw notFound("Role not found.");
  if (row.id === ADMIN_ROLE_ID) throw forbidden("The Administrator role can't be changed.");
  if ((await query("SELECT id FROM roles WHERE LOWER(name) = LOWER(?) AND id <> ?", [d.name, row.id])).length) throw conflict("A role with this name already exists.");
  await query("UPDATE roles SET name = ?, description = ?, permissions = ? WHERE id = ?", [d.name, d.description, JSON.stringify(normalizePermissions(d.permissions)), row.id]);
  const before = normalizePermissions(fromJson(row.permissions));
  const after = normalizePermissions(d.permissions);
  const diffs = MODULES.flatMap((m) => ACTIONS.filter((a) => before[m][a] !== after[m][a]).map((a) => `${after[m][a] ? "+" : "-"}${m}.${a}`));
  await audit(req, { action: "Update", module: "Roles", summary: `Updated role ${d.name}${diffs.length ? `: ${diffs.slice(0, 12).join(" ")}` : ""}` });
  res.json({ role: roleOut(await getRole(row.id), true) });
});

export const remove = wrap(async (req, res) => {
  const row = await getRole(req.params.id);
  if (!row) throw notFound("Role not found.");
  if (row.id === ADMIN_ROLE_ID) throw forbidden("The Administrator role can't be deleted.");
  const n = Number((await query("SELECT COUNT(*) AS n FROM users WHERE role_id = ?", [row.id]))[0].n);
  if (n > 0) throw conflict(`${n} user${n === 1 ? " has" : "s have"} this role. Move them to another role first.`);
  await query("DELETE FROM roles WHERE id = ?", [row.id]);
  await audit(req, { action: "Delete", module: "Roles", summary: `Deleted role ${row.name}` });
  res.json({ ok: true });
});
