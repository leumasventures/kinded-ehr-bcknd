// Nursing records: vitals and nursing notes. Both are append-only. A wrong entry is corrected by a new one, never edited
// or deleted, so the record shows what was believed at the time. These functions do not write the audit log; the controller does.
import { randomUUID } from "node:crypto";
import { query } from "../config/database.js";
import { bad } from "../utils/errors.js";

const num = (v) => (v === null || v === undefined ? null : Number(v));

/**
 * Screening thresholds so the screen can highlight a value. They are not a clinical judgement, and a ward may want its own.
 * "critical" means act now; "warning" means look at it.
 */
export function alertsFor(v) {
  const out = [];
  const add = (field, level, message) => out.push({ field, level, message });
  if (v.tempC != null) {
    if (v.tempC >= 39.5) add("tempC", "critical", "Very high temperature");
    else if (v.tempC >= 38) add("tempC", "warning", "Fever");
    else if (v.tempC < 35) add("tempC", "critical", "Low temperature");
  }
  if (v.pulse != null) {
    if (v.pulse > 140 || v.pulse < 40) add("pulse", "critical", v.pulse > 140 ? "Very fast pulse" : "Very slow pulse");
    else if (v.pulse > 120 || v.pulse < 50) add("pulse", "warning", v.pulse > 120 ? "Fast pulse" : "Slow pulse");
  }
  if (v.respRate != null) {
    if (v.respRate > 30 || v.respRate < 8) add("respRate", "critical", "Abnormal breathing rate");
    else if (v.respRate > 24 || v.respRate < 10) add("respRate", "warning", "Breathing rate outside the usual range");
  }
  if (v.bpSys != null) {
    if (v.bpSys < 80 || v.bpSys >= 200) add("bpSys", "critical", v.bpSys < 80 ? "Very low blood pressure" : "Very high blood pressure");
    else if (v.bpSys < 90 || v.bpSys >= 180) add("bpSys", "warning", v.bpSys < 90 ? "Low blood pressure" : "High blood pressure");
  }
  if (v.bpDia != null && v.bpDia >= 120) add("bpDia", "warning", "High diastolic pressure");
  if (v.spo2 != null) {
    if (v.spo2 < 90) add("spo2", "critical", "Low oxygen saturation");
    else if (v.spo2 < 94) add("spo2", "warning", "Oxygen saturation below the usual range");
  }
  return out;
}

const VITALS_SELECT = `SELECT v.*, p.name AS patient_name, u.name AS recorded_by_name FROM nursing_vitals v JOIN patients p ON p.id = v.patient_id LEFT JOIN users u ON u.id = v.recorded_by`;

export function vitalsOut(r) {
  const v = { tempC: num(r.temp_c), pulse: num(r.pulse), respRate: num(r.resp_rate), bpSys: num(r.bp_sys), bpDia: num(r.bp_dia), spo2: num(r.spo2), weightKg: num(r.weight_kg) };
  return { id: r.id, patientId: r.patient_id, patient: r.patient_name, admissionId: r.admission_id ?? null, ...v, notes: r.notes ?? null, recordedBy: r.recorded_by_name ?? null, recordedAt: r.recorded_at, alerts: alertsFor(v) };
}

export async function getVitals(id) {
  const [row] = await query(`${VITALS_SELECT} WHERE v.id = ?`, [id]);
  return row ? vitalsOut(row) : null;
}

export async function listVitals({ patientId, limit = 50 }) {
  const n = Math.min(Math.max(Number(limit) || 50, 1), 500);
  const rows = await query(`${VITALS_SELECT} WHERE v.patient_id = ? ORDER BY v.recorded_at DESC, v.id DESC LIMIT ${n}`, [patientId]);
  return rows.map(vitalsOut);
}

export async function recordVitals(d, by) {
  const [patient] = await query("SELECT id FROM patients WHERE id = ?", [d.patientId]);
  if (!patient) throw bad("That patient isn't registered. Register the patient first.");
  // If the patient is on a ward right now, the reading is tied to that admission.
  const [adm] = await query("SELECT id FROM admissions WHERE patient_id = ? AND status = 'Admitted'", [d.patientId]);
  const id = randomUUID();
  await query(
    "INSERT INTO nursing_vitals (id, patient_id, admission_id, recorded_by, recorded_at, temp_c, pulse, resp_rate, bp_sys, bp_dia, spo2, weight_kg, notes) VALUES (?,?,?,?,NOW(),?,?,?,?,?,?,?,?)",
    [id, d.patientId, adm?.id ?? null, by.id, d.tempC ?? null, d.pulse ?? null, d.respRate ?? null, d.bpSys ?? null, d.bpDia ?? null, d.spo2 ?? null, d.weightKg ?? null, d.notes || null]
  );
  return getVitals(id);
}

/** Every admitted patient with their latest vitals, for the ward round. Patients with no reading yet show empty values. */
export async function wardBoard({ ward } = {}) {
  const rows = await query(
    `SELECT a.id AS admission_id, a.patient_id, a.ward, a.bed, p.name AS patient_name, v.id, v.temp_c, v.pulse, v.resp_rate, v.bp_sys, v.bp_dia, v.spo2, v.weight_kg, v.notes, v.recorded_at, NULL AS recorded_by_name
       FROM admissions a
       JOIN patients p ON p.id = a.patient_id
       LEFT JOIN nursing_vitals v ON v.id = (SELECT id FROM nursing_vitals WHERE patient_id = a.patient_id ORDER BY recorded_at DESC, id DESC LIMIT 1)
      WHERE a.status = 'Admitted' ${ward ? "AND a.ward = ?" : ""}
      ORDER BY a.ward, a.bed, p.name`,
    ward ? [ward] : []
  );
  return rows.map((r) => ({
    admissionId: r.admission_id,
    patientId: r.patient_id,
    patient: r.patient_name,
    ward: r.ward ?? null,
    bed: r.bed ?? null,
    latest: r.id ? vitalsOut({ ...r, patient_id: r.patient_id, admission_id: r.admission_id }) : null,
  }));
}

const NOTE_SELECT = `SELECT n.id, n.patient_id, p.name AS patient_name, n.admission_id, n.note, n.created_at, u.name AS author FROM nursing_notes n JOIN patients p ON p.id = n.patient_id LEFT JOIN users u ON u.id = n.author_id`;
const noteOut = (r) => ({ id: r.id, patientId: r.patient_id, patient: r.patient_name, admissionId: r.admission_id ?? null, note: r.note, author: r.author ?? null, createdAt: r.created_at });

export async function listNotes({ patientId, limit = 50 }) {
  const n = Math.min(Math.max(Number(limit) || 50, 1), 500);
  return (await query(`${NOTE_SELECT} WHERE n.patient_id = ? ORDER BY n.created_at DESC, n.id DESC LIMIT ${n}`, [patientId])).map(noteOut);
}

export async function addNote({ patientId, note }, by) {
  const [patient] = await query("SELECT id FROM patients WHERE id = ?", [patientId]);
  if (!patient) throw bad("That patient isn't registered. Register the patient first.");
  const [adm] = await query("SELECT id FROM admissions WHERE patient_id = ? AND status = 'Admitted'", [patientId]);
  const id = randomUUID();
  await query("INSERT INTO nursing_notes (id, patient_id, admission_id, author_id, note, created_at) VALUES (?,?,?,?,?,NOW())", [id, patientId, adm?.id ?? null, by.id, note]);
  const [row] = await query(`${NOTE_SELECT} WHERE n.id = ?`, [id]);
  return noteOut(row);
}