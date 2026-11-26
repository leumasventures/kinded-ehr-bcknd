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

/** A row of the patient list: the record plus the two things the list shows at a glance. */
export const listOut = (r) => ({ ...patientOut(r), lastVisit: r.last_visit ?? null, admitted: !!Number(r.admitted) });

/** Someone with the same name and birth date, or the same phone number (last 10 digits), is probably already registered. */
export async function findDuplicates(d, ignoreId = "") {
  const last10 = digits(d.phone).slice(-10);
  const rows = await query(
    `SELECT * FROM patients WHERE id <> ? AND ((LOWER(name) = LOWER(?) AND dob = ?) OR (? <> '' AND RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 10) = ?))`,
    [ignoreId, d.name, d.dob, last10.length === 10 ? last10 : "", last10]
  );
  return rows.map(patientOut);
}

/**
 * One page of the register. `filters` may hold gender, payer and hasAllergies, which are applied here so that paging and the
 * total stay correct. Each row also says whether the patient is on a ward now and the date of their last completed visit.
 */
export async function searchPatients(q, limit, offset, filters = {}) {
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const where = [];
  const args = [];
  // Typing 0803 123 or 0803-123 should still find 08031234567, so the digits are also compared with the stored number's digits.
  const typedDigits = q.replace(/\D/g, "");
  const byDigits = typedDigits.length >= 3;
  if (q) {
    where.push(`(p.name LIKE ? OR p.id LIKE ? OR p.phone LIKE ?${byDigits ? " OR REGEXP_REPLACE(p.phone, '[^0-9]', '') LIKE ?" : ""})`);
    args.push(like, like, like, ...(byDigits ? [`%${typedDigits}%`] : []));
  }
  if (filters.gender) (where.push("p.gender = ?"), args.push(filters.gender));
  if (filters.payer) (where.push("p.payer = ?"), args.push(filters.payer));
  if (filters.hasAllergies) where.push("TRIM(p.allergies) <> ''");
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await query(
    `SELECT p.*,
            (SELECT DATE_FORMAT(MAX(a.appt_date), '%Y-%m-%d') FROM appointments a WHERE a.patient_id = p.id AND a.status = 'Completed') AS last_visit,
            EXISTS(SELECT 1 FROM admissions ad WHERE ad.patient_id = p.id AND ad.status = 'Admitted') AS admitted
       FROM patients p ${clause} ORDER BY p.name LIMIT ? OFFSET ?`,
    [...args, limit, offset]
  );
  const [{ n }] = await query(`SELECT COUNT(*) AS n FROM patients p ${clause}`, args);
  return { patients: rows.map(listOut), total: Number(n) };
}

/** The four numbers above the patient list. */
export async function patientStats() {
  const monthStart = `${today().slice(0, 8)}01`;
  const [r] = await query("SELECT COUNT(*) AS total, COALESCE(SUM(registered_on >= ?), 0) AS new_this_month, COALESCE(SUM(TRIM(allergies) <> ''), 0) AS with_allergies FROM patients", [monthStart]);
  const [adm] = await query("SELECT COUNT(DISTINCT patient_id) AS n FROM admissions WHERE status = 'Admitted'");
  return { total: Number(r.total), newThisMonth: Number(r.new_this_month), admitted: Number(adm.n), withAllergies: Number(r.with_allergies) };
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

/** Records in the hospital modules added later (wards, laboratory, pharmacy, nursing). Any of them means the patient is kept. */
export async function countOtherRecords(id) {
  const [r] = await query(
    `SELECT (SELECT COUNT(*) FROM admissions WHERE patient_id = ?) + (SELECT COUNT(*) FROM lab_orders WHERE patient_id = ?) +
            (SELECT COUNT(*) FROM prescriptions WHERE patient_id = ?) + (SELECT COUNT(*) FROM nursing_vitals WHERE patient_id = ?) +
            (SELECT COUNT(*) FROM nursing_notes WHERE patient_id = ?) AS n`,
    [id, id, id, id, id]
  );
  return Number(r.n);
}

export const deletePatientRow = (id) => query("DELETE FROM patients WHERE id = ?", [id]);