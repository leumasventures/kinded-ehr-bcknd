// Who is on duty, where and when. A shift that has started is part of the record of who was on duty, so entries dated
// before today can't be changed or deleted. These functions do not write the audit log; the controller does.
import { randomUUID } from "node:crypto";
import { query, tx } from "../config/database.js";
import { bad, conflict } from "../utils/errors.js";
import { SHIFTS } from "../validators/dutyroster.validator.js";

export const todayISO = () => new Date().toISOString().slice(0, 10);
export const addDaysISO = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const q = async (conn, sql, params = []) => (await conn.query(sql, params))[0];

const SELECT = `SELECT r.id, r.staff_id, u.name AS staff_name, u.role_id, DATE_FORMAT(r.shift_date, '%Y-%m-%d') AS shift_date, r.shift, r.department, r.notes
  FROM duty_roster r JOIN users u ON u.id = r.staff_id`;

export const entryOut = (r) => ({ id: r.id, staffId: r.staff_id, staff: r.staff_name, roleId: r.role_id, date: r.shift_date, shift: r.shift, department: r.department ?? null, notes: r.notes ?? null });

export async function getEntry(id) {
  const [row] = await query(`${SELECT} WHERE r.id = ?`, [id]);
  return row;
}

export async function listEntries({ from, to, staffId, department, limit = 500 } = {}) {
  const where = [];
  const args = [];
  if (from) (where.push("r.shift_date >= ?"), args.push(from));
  if (to) (where.push("r.shift_date <= ?"), args.push(to));
  if (staffId) (where.push("r.staff_id = ?"), args.push(staffId));
  if (department) (where.push("r.department = ?"), args.push(department));
  const n = Math.min(Math.max(Number(limit) || 500, 1), 1000);
  const rows = await query(`${SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY r.shift_date, FIELD(r.shift, 'Morning', 'Afternoon', 'Night'), u.name LIMIT ${n}`, args);
  return rows.map(entryOut);
}

/** Everyone rostered on one date, grouped by shift. Deactivated accounts are left out. */
export async function onDuty(date) {
  const rows = await query(`${SELECT} WHERE r.shift_date = ? AND u.active = 1 ORDER BY u.name`, [date]);
  return SHIFTS.map((shift) => ({ shift, staff: rows.filter((r) => r.shift === shift).map(entryOut) }));
}

const taken = (e) => (e?.errno === 1062 ? conflict("That person is already rostered for that shift on that day.") : e);
const notPast = (date) => {
  if (date < todayISO()) throw bad("You can't roster a shift in the past.");
};

export async function createEntry({ staffId, date, shift, department, notes }, by) {
  notPast(date);
  const [staff] = await query("SELECT id FROM users WHERE id = ? AND active = 1", [staffId]);
  if (!staff) throw bad("That staff member doesn't exist or isn't active.");
  const id = randomUUID();
  try {
    await query("INSERT INTO duty_roster (id, staff_id, shift_date, shift, department, notes, created_by) VALUES (?,?,?,?,?,?,?)", [id, staffId, date, shift, department || null, notes || null, by.id]);
  } catch (e) {
    throw taken(e);
  }
  return getEntry(id);
}

/** Rosters several people over several dates for one shift. Ones that already exist are skipped, not duplicated. */
export const assignShifts = ({ staffIds, dates, shift, department }, by) =>
  tx(async (conn) => {
    const ids = [...new Set(staffIds)];
    const days = [...new Set(dates)];
    days.forEach(notPast);
    const active = await q(conn, "SELECT id FROM users WHERE id IN (?) AND active = 1", [ids]);
    if (active.length !== ids.length) throw bad("One of those staff members doesn't exist or isn't active.");
    let created = 0;
    for (const staffId of ids) {
      for (const date of days) {
        const [res] = await conn.query("INSERT IGNORE INTO duty_roster (id, staff_id, shift_date, shift, department, created_by) VALUES (?,?,?,?,?,?)", [randomUUID(), staffId, date, shift, department || null, by.id]);
        created += res.affectedRows;
      }
    }
    return { created, skipped: ids.length * days.length - created };
  });

/** Applies only what changed. Returns the names of the fields that changed. */
export async function updateEntry(row, d) {
  if (row.shift_date < todayISO()) throw conflict("A shift that has already started can't be changed.");
  const map = { date: ["shift_date", row.shift_date], shift: ["shift", row.shift], department: ["department", row.department ?? null], notes: ["notes", row.notes ?? null] };
  const sets = [];
  const vals = [];
  const changed = [];
  for (const [key, [col, current]] of Object.entries(map)) {
    if (d[key] === undefined) continue;
    const v = d[key] === "" ? null : d[key];
    if (v === current) continue;
    sets.push(`${col} = ?`);
    vals.push(v);
    changed.push(key);
  }
  if (d.date !== undefined) notPast(d.date);
  if (!sets.length) return [];
  try {
    await query(`UPDATE duty_roster SET ${sets.join(", ")} WHERE id = ?`, [...vals, row.id]);
  } catch (e) {
    throw taken(e);
  }
  return changed;
}

export async function removeEntry(row) {
  if (row.shift_date < todayISO()) throw conflict("A shift that has already started can't be deleted.");
  await query("DELETE FROM duty_roster WHERE id = ?", [row.id]);
}