import { query, tx, fromJson } from "../config/database.js";

export const today = () => new Date().toISOString().slice(0, 10);
const digits = (s) => String(s ?? "").replace(/\D/g, "");

export const patientOut = (r) => ({
  id: r.id, name: r.name, dob: r.dob, gender: r.gender, phone: r.phone, address: r.address,
  bloodGroup: r.blood_group, genotype: r.genotype, payer: r.payer,
  payerName: r.payer_name ?? undefined, memberId: r.member_id ?? undefined,
  allergies: r.allergies, kinName: r.kin_name, kinRelation: r.kin_relation, kinPhone: r.kin_phone,
  notes: r.notes ?? undefined, mergedFrom: fromJson(r.merged_from) ?? undefined, registeredOn: r.registered_on,
});

/** Someone with the same name and birth date, or the same phone number (last 10 digits), is probably already registered. */
export async function findDuplicates(d, ignoreId = "") {
  const last10 = digits(d.phone).slice(-10);
  const rows = await query(
    `SELECT * FROM patients WHERE id <> ? AND ((LOWER(name) = LOWER(?) AND dob = ?) OR (? <> '' AND RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 10) = ?))`,
    [ignoreId, d.name, d.dob, last10.length === 10 ? last10 : "", last10]
  );
  return rows.map(patientOut);
}

export async function searchPatients(q, limit, offset) {
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const where = q ? "WHERE name LIKE ? OR id LIKE ? OR phone LIKE ?" : "";
  const args = q ? [like, like, like] : [];
  const rows = await query(`SELECT * FROM patients ${where} ORDER BY name LIMIT ? OFFSET ?`, [...args, limit, offset]);
  const [{ n }] = await query(`SELECT COUNT(*) AS n FROM patients ${where}`, args);
  return { patients: rows.map(patientOut), total: Number(n) };
}

export const getPatientRow = async (id) => (await query("SELECT * FROM patients WHERE id = ?", [id]))[0];

/** Takes the next number from the counter and inserts the patient in one transaction, so two clerks can never get the same ID. */
export async function createPatient(d, createdBy) {
  const id = await tx(async (conn) => {
    await conn.query("UPDATE counters SET value = LAST_INSERT_ID(value + 1) WHERE name = 'patient'");
    const [[{ n }]] = await conn.query("SELECT LAST_INSERT_ID() AS n");
    const pid = `P-${n}`;
    await conn.query(
      `INSERT INTO patients (id, name, dob, gender, phone, address, blood_group, genotype, payer, payer_name, member_id, allergies, kin_name, kin_relation, kin_phone, notes, registered_on, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [pid, d.name, d.dob, d.gender, d.phone, d.address, d.bloodGroup, d.genotype, d.payer, d.payerName || null, d.memberId || null, d.allergies, d.kinName, d.kinRelation, d.kinPhone, d.notes || null, today(), createdBy]
    );
    return pid;
  });
  return getPatientRow(id);
}

const FIELD_LABEL = { name: "name", dob: "date of birth", gender: "gender", phone: "phone", address: "address", blood_group: "blood group", genotype: "genotype", payer: "payer", payer_name: "insurer", member_id: "member ID", allergies: "allergies", kin_name: "next of kin", kin_relation: "next of kin relationship", kin_phone: "next of kin phone", notes: "notes" };

/** Saves only what changed. Returns the labels of the changed fields (never their values) for the audit log. */
export async function updatePatient(row, d) {
  const next = { name: d.name, dob: d.dob, gender: d.gender, phone: d.phone, address: d.address, blood_group: d.bloodGroup, genotype: d.genotype, payer: d.payer, payer_name: d.payerName || null, member_id: d.memberId || null, allergies: d.allergies, kin_name: d.kinName, kin_relation: d.kinRelation, kin_phone: d.kinPhone, notes: d.notes || null };
  const changed = Object.keys(next).filter((k) => (row[k] ?? null) !== next[k]);
  if (changed.length) await query(`UPDATE patients SET ${changed.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, [...changed.map((k) => next[k]), row.id]);
  return changed.map((k) => FIELD_LABEL[k]);
}

export const countNotes = async (id) => Number((await query("SELECT COUNT(*) AS n FROM clinical_notes WHERE patient_id = ?", [id]))[0].n);
export const deletePatientRow = (id) => query("DELETE FROM patients WHERE id = ?", [id]);
