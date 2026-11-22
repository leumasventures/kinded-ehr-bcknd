import { randomUUID } from "node:crypto";
import { query } from "../config/database.js";
import { conflict } from "../utils/errors.js";

// patients.name holds the full name (as in billing.service.js).
const PATIENT_NAME = "p.name";

const FROM = `FROM admissions a LEFT JOIN patients p ON p.id = a.patient_id LEFT JOIN users d ON d.id = a.doctor_id`;
const LIST_COLS = `a.id, a.patient_id, ${PATIENT_NAME} AS patient_name, a.doctor_id, d.name AS doctor, a.ward, a.bed, a.status, a.admitted_at, a.discharged_at`;
// The clinical text is only returned when one admission is opened, not in lists.
const FULL_COLS = `${LIST_COLS}, a.reason, a.outcome, a.discharge_summary`;

export const admissionOut = (r) => ({
  id: r.id,
  patientId: r.patient_id,
  patientName: r.patient_name ?? null,
  doctorId: r.doctor_id ?? null,
  doctor: r.doctor ?? null,
  ward: r.ward ?? null,
  bed: r.bed ?? null,
  status: r.status,
  admittedAt: r.admitted_at,
  dischargedAt: r.discharged_at ?? null,
  ...("reason" in r ? { reason: r.reason, outcome: r.outcome ?? null, dischargeSummary: r.discharge_summary ?? null } : {}),
});

export async function getAdmission(id) {
  const [row] = await query(`SELECT ${FULL_COLS} ${FROM} WHERE a.id = ?`, [id]);
  return row;
}

export async function listAdmissions({ status, ward, doctorId, patientId, limit }) {
  const where = [];
  const vals = [];
  if (status) (where.push("a.status = ?"), vals.push(status));
  if (ward) (where.push("a.ward = ?"), vals.push(ward));
  if (doctorId) (where.push("a.doctor_id = ?"), vals.push(doctorId));
  if (patientId) (where.push("a.patient_id = ?"), vals.push(patientId));
  const rows = await query(
    `SELECT ${LIST_COLS} ${FROM} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY a.admitted_at DESC LIMIT ${Number(limit) | 0}`,
    vals
  );
  return rows.map(admissionOut);
}

export async function wardCensus() {
  const rows = await query("SELECT COALESCE(ward, 'Unassigned') AS ward, COUNT(*) AS occupied FROM admissions WHERE status = 'Admitted' GROUP BY ward ORDER BY ward");
  return rows.map((r) => ({ ward: r.ward, occupied: Number(r.occupied) }));
}

export async function doctorExists(id) {
  const [row] = await query("SELECT id FROM users WHERE id = ? AND active = 1", [id]);
  return !!row;
}

async function bedHolder(ward, bed, exceptId = "") {
  if (!ward || !bed) return null;
  const [row] = await query("SELECT id FROM admissions WHERE status = 'Admitted' AND ward = ? AND bed = ? AND id <> ?", [ward, bed, exceptId]);
  return row ?? null;
}

// The unique keys on admissions are the real guard against two people grabbing the same bed at once.
// The checks above give friendly messages; this turns the database's refusal into the same kind of message.
const raced = (e) => (e?.errno === 1062 ? conflict("That bed was just taken, or this patient was just admitted. Refresh and check.") : e);

export async function createAdmission(d, userId) {
  const [open] = await query("SELECT id FROM admissions WHERE patient_id = ? AND status = 'Admitted'", [d.patientId]);
  if (open) throw conflict("This patient is already admitted.");
  if (await bedHolder(d.ward, d.bed)) throw conflict(`Bed ${d.bed} in ${d.ward} is occupied.`);
  const id = randomUUID();
  try {
    await query("INSERT INTO admissions (id, patient_id, doctor_id, ward, bed, reason, status, admitted_at, created_by) VALUES (?,?,?,?,?,?, 'Admitted', NOW(), ?)", [id, d.patientId, d.doctorId || null, d.ward || null, d.bed || null, d.reason, userId]);
  } catch (e) {
    throw raced(e);
  }
  return getAdmission(id);
}

const COLUMNS = { doctorId: "doctor_id", ward: "ward", bed: "bed", reason: "reason" };

/** Applies only what changed. Returns the names of the fields that changed. */
export async function updateAdmission(row, d) {
  const current = { doctorId: row.doctor_id, ward: row.ward, bed: row.bed, reason: row.reason };
  const sets = [];
  const vals = [];
  const changed = [];
  for (const [key, col] of Object.entries(COLUMNS)) {
    if (d[key] === undefined) continue;
    const v = d[key] === "" ? null : d[key];
    if (v === (current[key] ?? null)) continue;
    sets.push(`${col} = ?`);
    vals.push(v);
    changed.push(key);
  }
  if (sets.length === 0) return [];
  const ward = d.ward !== undefined ? d.ward || null : row.ward;
  const bed = d.bed !== undefined ? d.bed || null : row.bed;
  if (bed && !ward) throw conflict("Choose a ward for that bed.");
  if ((changed.includes("ward") || changed.includes("bed")) && (await bedHolder(ward, bed, row.id))) throw conflict(`Bed ${bed} in ${ward} is occupied.`);
  try {
    await query(`UPDATE admissions SET ${sets.join(", ")} WHERE id = ?`, [...vals, row.id]);
  } catch (e) {
    throw raced(e);
  }
  return changed;
}

// Discharging frees the bed and the patient automatically: the unique keys only apply while status is 'Admitted'.
export async function dischargeAdmission(row, d) {
  await query("UPDATE admissions SET status = 'Discharged', discharged_at = NOW(), outcome = ?, discharge_summary = ? WHERE id = ? AND status = 'Admitted'", [d.outcome, d.summary || null, row.id]);
}