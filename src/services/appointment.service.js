import { query, tx } from "../config/database.js";
import { conflict } from "../utils/errors.js";

const SELECT = `SELECT a.*, p.name AS patient_name, p.phone AS patient_phone
  FROM appointments a JOIN patients p ON p.id = a.patient_id`;

export const appointmentOut = (r) => ({
  id: r.id,
  patientId: r.patient_id,
  patient: r.patient_name,
  phone: r.patient_phone || undefined,
  doctor: r.doctor,
  date: r.appt_date,
  time: r.appt_time,
  type: r.visit_type,
  reason: r.reason ?? undefined,
  status: r.status,
});

// Who may move to which status. Finished appointments stay finished; a cancelled or missed one can be booked again.
export const TRANSITIONS = {
  Scheduled: ["Checked in", "In Progress", "Cancelled", "No-show"],
  "Checked in": ["In Progress", "Cancelled"],
  "In Progress": ["Completed"],
  Completed: [],
  Cancelled: ["Scheduled"],
  "No-show": ["Scheduled"],
};
export const isLive = (status) => status !== "Cancelled" && status !== "No-show";

export const getAppointment = async (id) => (await query(`${SELECT} WHERE a.id = ?`, [id]))[0];

export async function listAppointments({ date, from, to, doctor, patientId, status, limit }) {
  const where = [];
  const args = [];
  if (date) (where.push("a.appt_date = ?"), args.push(date));
  if (from) (where.push("a.appt_date >= ?"), args.push(from));
  if (to) (where.push("a.appt_date <= ?"), args.push(to));
  if (doctor) (where.push("a.doctor = ?"), args.push(doctor));
  if (patientId) (where.push("a.patient_id = ?"), args.push(patientId));
  if (status) (where.push("a.status = ?"), args.push(status));
  const rows = await query(`${SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ${newestFirst ? "a.appt_date DESC, a.appt_time DESC, a.id DESC" : "a.appt_date, a.appt_time, a.id"} LIMIT ?`, [...args, limit]);
  return rows.map(appointmentOut);
}

/** The UNIQUE index on active_slot is what really prevents a double booking, so two clerks clicking at once can't both win. */
const slotTaken = (e) => (e?.code === "ER_DUP_ENTRY" ? conflict("That doctor is already booked at that date and time. Choose another slot.", { code: "slot_taken" }) : e);

export async function createAppointment(d, createdBy) {
  try {
    const id = await tx(async (conn) => {
      await conn.query("UPDATE counters SET value = LAST_INSERT_ID(value + 1) WHERE name = 'appointment'");
      const [[{ n }]] = await conn.query("SELECT LAST_INSERT_ID() AS n");
      const aid = `A-${n}`;
      await conn.query("INSERT INTO appointments (id, patient_id, doctor, appt_date, appt_time, visit_type, reason, created_by) VALUES (?,?,?,?,?,?,?,?)", [aid, d.patientId, d.doctor, d.date, d.time, d.type, d.reason || null, createdBy]);
      return aid;
    });
    return getAppointment(id);
  } catch (e) {
    throw slotTaken(e);
  }
}

/** Saves the fields that were sent. Returns the names of the fields that actually changed. */
export async function updateAppointment(row, d) {
  const next = { doctor: d.doctor, appt_date: d.date, appt_time: d.time, visit_type: d.type, reason: d.reason === undefined ? undefined : d.reason || null };
  const changed = Object.keys(next).filter((k) => next[k] !== undefined && (row[k] ?? null) !== next[k]);
  if (!changed.length) return [];
  try {
    await query(`UPDATE appointments SET ${changed.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, [...changed.map((k) => next[k]), row.id]);
  } catch (e) {
    throw slotTaken(e);
  }
  const LABEL = { doctor: "doctor", appt_date: "date", appt_time: "time", visit_type: "visit type", reason: "reason" };
  return changed.map((k) => LABEL[k]);
}

export async function setStatus(row, status) {
  try {
    await query("UPDATE appointments SET status = ? WHERE id = ?", [status, row.id]);
  } catch (e) {
    throw slotTaken(e); // re-booking a cancelled appointment into a slot someone else has since taken
  }
}

export const countNotesFor = async (id) => Number((await query("SELECT COUNT(*) AS n FROM clinical_notes WHERE appointment_id = ?", [id]))[0].n);
export const deleteAppointmentRow = (id) => query("DELETE FROM appointments WHERE id = ?", [id]);
export const countForPatient = async (patientId) => Number((await query("SELECT COUNT(*) AS n FROM appointments WHERE patient_id = ?", [patientId]))[0].n);
