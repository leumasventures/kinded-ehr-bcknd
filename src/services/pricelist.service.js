import { randomUUID } from "node:crypto";
import { query } from "../config/database.js";
import { conflict } from "../utils/errors.js";

const COLS = "id, code, name, category, price, active";

export const itemOut = (r) => ({ id: r.id, code: r.code, name: r.name, category: r.category, price: Number(r.price), active: !!r.active });

export async function getItem(id) {
  const [row] = await query(`SELECT ${COLS} FROM price_list WHERE id = ?`, [id]);
  return row;
}

export async function getByCode(code) {
  const [row] = await query(`SELECT ${COLS} FROM price_list WHERE code = ?`, [code]);
  return row;
}

const like = (s) => `%${s.replace(/[\\%_]/g, "\\$&")}%`;

export async function listItems({ q, category, includeInactive, limit }) {
  const where = [];
  const vals = [];
  if (!includeInactive) where.push("active = 1");
  if (category) (where.push("category = ?"), vals.push(category));
  if (q) (where.push("(code LIKE ? OR name LIKE ?)"), vals.push(like(q), like(q)));
  const rows = await query(`SELECT ${COLS} FROM price_list ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY category, name LIMIT ${Number(limit) | 0}`, vals);
  return rows.map(itemOut);
}

export async function listCategories() {
  const rows = await query("SELECT category, COUNT(*) AS items FROM price_list WHERE active = 1 GROUP BY category ORDER BY category");
  return rows.map((r) => ({ category: r.category, items: Number(r.items) }));
}

export async function createItem(d) {
  const id = randomUUID();
  try {
    await query("INSERT INTO price_list (id, code, name, category, price, active) VALUES (?,?,?,?,?,1)", [id, d.code.toUpperCase(), d.name, d.category, d.price]);
  } catch (e) {
    if (e?.errno === 1062) throw conflict("An item with this code already exists.");
    throw e;
  }
  return getItem(id);
}

const COLUMNS = { name: "name", category: "category", price: "price", active: "active" };

/** Applies only what changed. Returns human-readable descriptions of the changes. */
export async function updateItem(row, d) {
  const sets = [];
  const vals = [];
  const changed = [];
  for (const [key, col] of Object.entries(COLUMNS)) {
    if (d[key] === undefined) continue;
    if (key === "active") {
      if (d.active === !!row.active) continue;
      sets.push("active = ?");
      vals.push(d.active ? 1 : 0);
      changed.push(d.active ? "switched on" : "switched off");
    } else {
      if (d[key] === (key === "price" ? Number(row.price) : row[key])) continue;
      sets.push(`${col} = ?`);
      vals.push(d[key]);
      changed.push(key === "price" ? `price ${Number(row.price).toFixed(2)} to ${d.price.toFixed(2)}` : key);
    }
  }
  if (sets.length) await query(`UPDATE price_list SET ${sets.join(", ")} WHERE id = ?`, [...vals, row.id]);
  return changed;
}