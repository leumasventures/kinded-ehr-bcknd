import { randomUUID } from "node:crypto";
import { query } from "../config/database.js";
import { conflict } from "../utils/errors.js";
import { CATEGORY_PREFIX } from "../validators/pricelist.validator.js";

const COLS = "id, code, name, category, unit, price, active";

export const itemOut = (r) => ({ id: r.id, code: r.code, name: r.name, category: r.category, unit: r.unit, price: Number(r.price), active: !!r.active });

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
  const rows = await query(`SELECT ${COLS} FROM price_list ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY category, code LIMIT ${Number(limit) | 0}`, vals);
  return rows.map(itemOut);
}

export async function listCategories() {
  const rows = await query("SELECT category, COUNT(*) AS items FROM price_list WHERE active = 1 GROUP BY category ORDER BY category");
  return rows.map((r) => ({ category: r.category, items: Number(r.items) }));
}

/** Next free code for a category, e.g. LAB-014. A clash from two people at once is caught by the unique key and retried. */
async function nextCode(category) {
  const prefix = CATEGORY_PREFIX[category] ?? category.slice(0, 3).toUpperCase();
  const rows = await query("SELECT code FROM price_list WHERE code LIKE ?", [`${prefix}-%`]);
  const max = rows.reduce((m, r) => {
    const n = parseInt(String(r.code).slice(prefix.length + 1), 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

async function assertNotDuplicate(category, name, exceptId = "") {
  const [dup] = await query("SELECT id FROM price_list WHERE active = 1 AND category = ? AND name = ? AND id <> ?", [category, name, exceptId]);
  if (dup) throw conflict("That item already exists in this category.");
}

export async function createItem(d) {
  await assertNotDuplicate(d.category, d.name);
  const id = randomUUID();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = d.code ? d.code.toUpperCase() : await nextCode(d.category);
    try {
      await query("INSERT INTO price_list (id, code, name, category, unit, price, active) VALUES (?,?,?,?,?,?,1)", [id, code, d.name, d.category, d.unit, d.price]);
      return getItem(id);
    } catch (e) {
      if (e?.errno !== 1062) throw e;
      if (d.code) throw conflict("An item with this code already exists.");
      // otherwise someone took the same number a moment ago: try the next one
    }
  }
  throw conflict("Couldn't assign a code just now. Try again.");
}

/** Applies only what changed. Moving an item to another category gives it a code from that category. Returns descriptions of the changes. */
export async function updateItem(row, d) {
  const name = d.name ?? row.name;
  const category = d.category ?? row.category;
  const active = d.active ?? !!row.active;
  const moved = d.category !== undefined && d.category !== row.category;
  if (active && (moved || d.name !== undefined || (d.active === true && !row.active))) await assertNotDuplicate(category, name, row.id);

  const sets = [];
  const vals = [];
  const changed = [];
  if (d.name !== undefined && d.name !== row.name) (sets.push("name = ?"), vals.push(d.name), changed.push("name"));
  if (d.unit !== undefined && d.unit !== row.unit) (sets.push("unit = ?"), vals.push(d.unit), changed.push("unit"));
  if (d.price !== undefined && d.price !== Number(row.price)) (sets.push("price = ?"), vals.push(d.price), changed.push(`price ${Number(row.price).toFixed(2)} to ${d.price.toFixed(2)}`));
  if (moved) {
    const code = await nextCode(category);
    sets.push("category = ?", "code = ?");
    vals.push(category, code);
    changed.push(`category ${row.category} to ${category} (code ${row.code} to ${code})`);
  }
  if (d.active !== undefined && d.active !== !!row.active) (sets.push("active = ?"), vals.push(d.active ? 1 : 0), changed.push(d.active ? "switched on" : "removed from the list"));
  if (sets.length) {
    try {
      await query(`UPDATE price_list SET ${sets.join(", ")} WHERE id = ?`, [...vals, row.id]);
    } catch (e) {
      if (e?.errno === 1062) throw conflict("Couldn't assign a code just now. Try again.");
      throw e;
    }
  }
  return changed;
}