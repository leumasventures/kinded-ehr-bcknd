import { query, tx } from "../config/database.js";
import { bad, conflict, notFound } from "../utils/errors.js";
import { MAX_SPAN_DAYS, UNITS } from "../validators/roster.validator.js";

export const shiftOut = (r) => ({ id: String(r.id), date: r.shift_date, staffId: r.staff_id, staffName: r.staff_name, staffRole: r.staff_role, shift: r.shift, unit: r.unit, note: r.note, createdBy: r.created_by ?? "", createdAt: new Date(r.created_at).getTime() });

export async function listShifts({ from, to, staffId, limit = 1000 }) {
  const where = [];
  const args = [];
  if (from) (where.push("shift_date >= ?"), args.push(from));
  if (to) (where.push("shift_date <= ?"), args.push(to));
  if (staffId) (where.push("staff_id = ?"), args.push(staffId));
  const rows = await query(`SELECT * FROM roster_shifts ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY shift_date, staff_name LIMIT ${Math.min(Math.max(Number(limit) || 1000, 1), 2000)}`, args);
  return rows.map(shiftOut);
}

const dayNumber = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

/**
 * Adds shifts. Staff name and role are read from the staff record, never taken from the request.
 * One shift per person per day: onConflict "fail" rejects the whole request (nothing saved), "skip" saves the rest.
 * All the dates in one request must lie within nine weeks of each other.
 */
export async function createShifts(entries, { onConflict = "fail", by }) {
  const days = entries.map((e) => dayNumber(e.date));
  if (Math.max(...days) - Math.min(...days) >= MAX_SPAN_DAYS) throw bad("Add no more than nine weeks of shifts at a time.");
  for (const e of entries) if (e.unit && !UNITS.includes(e.unit)) throw bad(`"${e.unit}" is not a unit in this hospital.`);
  return tx(async (conn) => {
    const ids = [...new Set(entries.map((e) => e.staffId))];
    const [staff] = await conn.query("SELECT u.id, u.name, u.active, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id IN (?)", [ids]);
    const byId = new Map(staff.map((s) => [s.id, s]));
    for (const id of ids) {
      const s = byId.get(id);
      if (!s) throw notFound("One of the staff members doesn't exist.");
      if (!s.active) throw conflict(`${s.name}'s account is deactivated, so they can't be given shifts.`);
    }
    const created = [];
    const skipped = [];
    const seen = new Set();
    for (const e of entries) {
      const key = `${e.staffId}|${e.date}`;
      const s = byId.get(e.staffId);
      const [exists] = await conn.query("SELECT id FROM roster_shifts WHERE staff_id = ? AND shift_date = ? FOR UPDATE", [e.staffId, e.date]);
      if (exists.length || seen.has(key)) {
        if (onConflict === "skip") {
          skipped.push({ date: e.date, staffId: e.staffId, staffName: s.name });
          continue;
        }
        throw conflict(`${s.name} already has a shift on ${e.date}.`, { code: "shift_exists" });
      }
      seen.add(key);
      const [r] = await conn.query("INSERT INTO roster_shifts (shift_date, staff_id, staff_name, staff_role, shift, unit, note, created_by) VALUES (?,?,?,?,?,?,?,?)", [e.date, e.staffId, s.name, s.role_name, e.shift, e.unit, e.note, by]);
      created.push(r.insertId);
    }
    const rows = created.length ? (await conn.query("SELECT * FROM roster_shifts WHERE id IN (?) ORDER BY shift_date, staff_name", [created]))[0] : [];
    return { created: rows.map(shiftOut), skipped };
  });
}

export const getShiftRow = async (id) => (await query("SELECT * FROM roster_shifts WHERE id = ?", [id]))[0];

export async function updateShift(row, d) {
  if (d.unit && !UNITS.includes(d.unit)) throw bad(`"${d.unit}" is not a unit in this hospital.`);
  const sets = [];
  const vals = [];
  for (const [k, col] of [["shift", "shift"], ["unit", "unit"], ["note", "note"]]) if (d[k] !== undefined) (sets.push(`${col} = ?`), vals.push(d[k]));
  if (sets.length) await query(`UPDATE roster_shifts SET ${sets.join(", ")} WHERE id = ?`, [...vals, row.id]);
  return shiftOut(await getShiftRow(row.id));
}

export const deleteShift = (id) => query("DELETE FROM roster_shifts WHERE id = ?", [id]);
