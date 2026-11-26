import { query, tx } from "../config/database.js";
import { bad, conflict, notFound } from "../utils/errors.js";
import { WARDS, bedsOf, wardNamed } from "../validators/admission.validator.js";
import { lockName, nextCounter, todayISO } from "./ids.js";

const SELECT = "SELECT a.*, p.name AS patient_name FROM admissions a JOIN patients p ON p.id = a.patient_id";

export const admissionOut = (r) => ({
  id: r.id,
  patientId: r.patient_id,
  patient: r.patient_name,
  ward: r.ward,
  bed: r.bed,
  admittedOn: r.admitted_on,
  doctor: r.doctor,
  diagnosis: r.diagnosis,
  status: r.status,
  dischargedOn: r.discharged_on ?? undefined,
  outcome: r.outcome ?? undefined,
  dischargeNotes: r.discharge_notes ?? undefined,
});

export async function listAdmissions({ status, ward, patientId, limit = 300 } = {}) {
  const where = [];
  const args = [];
  if (status) (where.push("a.status = ?"), args.push(status));
  if (ward) (where.push("a.ward = ?"), args.push(ward));
  if (patientId) (where.push("a.patient_id = ?"), args.push(patientId));
  const rows = await query(`${SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY a.status = 'Admitted' DESC, a.admitted_on DESC, a.id DESC LIMIT ${Math.min(Math.max(Number(limit) || 300, 1), 500)}`, args);
  return rows.map(admissionOut);
}

export const getAdmissionRow = async (id, conn = null) => ((conn ? (await conn.query(`${SELECT} WHERE a.id = ?`, [id]))[0] : await query(`${SELECT} WHERE a.id = ?`, [id])))[0];

export async function history(id) {
  const rows = await query("SELECT * FROM admission_moves WHERE admission_id = ? ORDER BY id", [id]);
  return rows.map((m) => ({ at: m.at, from: `${m.from_ward} ${m.from_bed}`, to: `${m.to_ward} ${m.to_bed}`, by: m.by_name }));
}

/** Every ward with its beds and who is in each one right now. */
export async function occupancy() {
  const rows = await query(`${SELECT} WHERE a.status = 'Admitted'`);
  return WARDS.map((w) => {
    const here = rows.filter((r) => r.ward === w.name);
    const taken = new Map(here.map((r) => [r.bed, r]));
    return {
      ward: w.name,
      total: w.beds,
      occupied: here.length,
      free: w.beds - here.length,
      beds: bedsOf(w.name).map((bed) => ({ bed, admissionId: taken.get(bed)?.id ?? null, patientId: taken.get(bed)?.patient_id ?? null, patient: taken.get(bed)?.patient_name ?? null })),
    };
  });
}

async function assertBedFree(conn, ward, bed, exceptId = "") {
  if (!bedsOf(ward).includes(bed)) throw bad(`${bed} isn't a bed in ${ward}.`);
  const [taken] = await conn.query("SELECT id FROM admissions WHERE ward = ? AND bed = ? AND status = 'Admitted' AND id <> ?", [ward, bed, exceptId]);
  if (taken.length) throw conflict(`Bed ${bed} in ${ward} is already taken.`, { code: "bed_taken" });
}

export async function admit({ patientId, ward, bed, doctor, diagnosis, admittedOn = todayISO() }, by) {
  if (admittedOn > todayISO()) throw bad("The admission date can't be in the future.");
  const id = await tx(async (conn) => {
    const [pat] = await conn.query("SELECT id FROM patients WHERE id = ? FOR UPDATE", [patientId]); // queues two admissions of the same patient
    if (!pat.length) throw bad("That patient isn't registered. Register the patient first.");
    const [dr] = await conn.query("SELECT id FROM doctors WHERE name = ?", [doctor]);
    if (!dr.length) throw bad("That doctor isn't in the directory. Add the doctor under Doctors first.");
    const [already] = await conn.query("SELECT id, ward, bed FROM admissions WHERE patient_id = ? AND status = 'Admitted'", [patientId]);
    if (already.length) throw conflict(`This patient is already admitted (${already[0].ward}, bed ${already[0].bed}).`, { code: "already_admitted" });
    await lockName(conn, `ward:${ward}`);
    await assertBedFree(conn, ward, bed);
    const aid = `ADM-${await nextCounter(conn, "admission", 1000)}`;
    await conn.query("INSERT INTO admissions (id, patient_id, ward, bed, admitted_on, doctor, diagnosis, created_by) VALUES (?,?,?,?,?,?,?,?)", [aid, patientId, ward, bed, admittedOn, doctor, diagnosis, by.id]);
    return aid;
  });
  return admissionOut(await getAdmissionRow(id));
}

export async function transfer(id, { ward, bed }, by) {
  await tx(async (conn) => {
    await lockName(conn, `ward:${ward}`);
    const [[a]] = await conn.query("SELECT * FROM admissions WHERE id = ? FOR UPDATE", [id]);
    if (!a) throw notFound("Admission not found.");
    if (a.status !== "Admitted") throw conflict("A discharged patient can't be moved.");
    if (a.ward === ward && a.bed === bed) throw bad("The patient is already in that bed.");
    await assertBedFree(conn, ward, bed, id);
    await conn.query("UPDATE admissions SET ward = ?, bed = ? WHERE id = ?", [ward, bed, id]);
    await conn.query("INSERT INTO admission_moves (admission_id, from_ward, from_bed, to_ward, to_bed, by_name) VALUES (?,?,?,?,?,?)", [id, a.ward, a.bed, ward, bed, by.name]);
  });
  return admissionOut(await getAdmissionRow(id));
}

export async function discharge(id, { outcome, notes = "", dischargedOn = todayISO() }) {
  await tx(async (conn) => {
    const [[a]] = await conn.query("SELECT * FROM admissions WHERE id = ? FOR UPDATE", [id]);
    if (!a) throw notFound("Admission not found.");
    if (a.status !== "Admitted") throw conflict("This patient has already been discharged.");
    if (dischargedOn < a.admitted_on) throw bad("The discharge date can't be before the admission date.");
    if (dischargedOn > todayISO()) throw bad("The discharge date can't be in the future.");
    await conn.query("UPDATE admissions SET status = 'Discharged', discharged_on = ?, outcome = ?, discharge_notes = ? WHERE id = ?", [dischargedOn, outcome, notes || null, id]);
  });
  return admissionOut(await getAdmissionRow(id));
}

export const wardOf = (name) => wardNamed(name);
