// Merging two registrations of the same person. Every record that points at the duplicate is moved to the patient being kept,
// the duplicate is removed from the register, and a copy of what was removed is written to an append-only merge log.
// It all happens in ONE transaction: either the whole merge is saved or none of it is, so a failure half-way can never leave
// some records on one registration and some on the other.
import { query, tx, fromJson } from "../config/database.js";
import { bad, conflict, notFound } from "../utils/errors.js";
import { patientOut } from "./patient.service.js";

/**
 * Every table that points at a patient. This list is the one place to extend: when a new module that stores a `patient_id`
 * is added (admissions, lab orders, dispensing, triage, prescriptions, documents ...), add it here and the merge moves it too.
 * `label: null` means the table follows another one and is not shown to the person doing the merge.
 */
export const PATIENT_LINKS = [
  { label: "Appointments", table: "appointments" },
  { label: "Clinical notes", table: "clinical_notes" },
  { label: "Invoices", table: "invoices" },
  { label: null, table: "invoice_items" },
  { label: "Claim lines", table: "claim_lines" },
];

/** How many records of each kind belong to a patient. Shown before a merge so the person can see what will move. */
export async function recordCounts(patientId) {
  const counts = {};
  for (const l of PATIENT_LINKS.filter((x) => x.label)) counts[l.label] = Number((await query(`SELECT COUNT(*) AS n FROM \`${l.table}\` WHERE patient_id = ?`, [patientId]))[0].n);
  return counts;
}

/** A reason the two registrations can't be merged, or null when it is safe to go ahead. Add checks here (for example "both admitted"). */
export function mergeBlocker(keep, dupe) {
  if (keep.id === dupe.id) return "Choose two different patients.";
  return null;
}

const unknown = (v) => !v || v === "Unknown";
const unionAllergies = (a, b) => {
  const seen = new Set();
  return [...String(a ?? "").split(","), ...String(b ?? "").split(",")]
    .map((x) => x.trim())
    .filter((x) => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()))
    .join(", ");
};

/** The kept patient's own details win. Anything it is missing is filled in from the duplicate. */
export function mergedFields(keep, dupe) {
  const keepFrom = fromJson(keep.merged_from, []);
  return {
    phone: keep.phone || dupe.phone,
    address: keep.address || dupe.address,
    blood_group: unknown(keep.blood_group) ? dupe.blood_group : keep.blood_group,
    genotype: unknown(keep.genotype) ? dupe.genotype : keep.genotype,
    allergies: unionAllergies(keep.allergies, dupe.allergies),
    kin_name: keep.kin_name || dupe.kin_name,
    kin_relation: keep.kin_name ? keep.kin_relation : dupe.kin_relation,
    kin_phone: keep.kin_phone || dupe.kin_phone,
    payer_name: keep.payer_name || dupe.payer_name || null,
    member_id: keep.member_id || dupe.member_id || null,
    notes: [keep.notes, dupe.notes].filter(Boolean).join("\n") || null,
    registered_on: keep.registered_on < dupe.registered_on ? keep.registered_on : dupe.registered_on,
    merged_from: JSON.stringify([...(keepFrom ?? []), dupe.id]),
  };
}

/**
 * Merges `dupeId` into `keepId`. `by` is the signed-in user ({ id, name }).
 * Both patient rows are locked (in a fixed order, so two merges can't deadlock) before anything moves.
 * Returns what moved, for the audit log, and the kept patient's new record.
 */
export async function mergePatients(keepId, dupeId, by) {
  if (keepId === dupeId) throw bad("Choose two different patients.");
  return tx(async (conn) => {
    const rows = (await conn.query("SELECT * FROM patients WHERE id IN (?) ORDER BY id FOR UPDATE", [[keepId, dupeId]]))[0];
    const keep = rows.find((r) => r.id === keepId);
    const dupe = rows.find((r) => r.id === dupeId);
    if (!keep || !dupe) throw notFound("One of the patients is no longer on the register.");
    const blocked = mergeBlocker(keep, dupe);
    if (blocked) throw conflict(blocked);

    const next = mergedFields(keep, dupe);
    const moved = {};
    try {
      // A claim line remembers the member ID. Fill it from the merged record where it was empty, then move the lines.
      await conn.query("UPDATE claim_lines SET member_id = ? WHERE patient_id = ? AND member_id IS NULL", [next.member_id, dupe.id]);
      for (const l of PATIENT_LINKS) {
        const [r] = await conn.query(`UPDATE \`${l.table}\` SET patient_id = ? WHERE patient_id = ?`, [keep.id, dupe.id]);
        if (l.label && r.affectedRows) moved[l.label] = r.affectedRows;
      }
    } catch (e) {
      // Both registrations carry the same automatic charge (same event and description). Something is wrong with the data, so stop.
      if (e?.code === "ER_DUP_ENTRY") throw conflict("Both registrations were charged for the same event. Ask an administrator to check their invoices before merging.");
      throw e;
    }

    const removed = patientOut(dupe);
    await conn.query("DELETE FROM patients WHERE id = ?", [dupe.id]);
    const cols = Object.keys(next);
    await conn.query(`UPDATE patients SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`, [...cols.map((c) => next[c]), keep.id]);
    await conn.query("INSERT INTO patient_merges (by_user_id, by_name, kept_id, removed_id, removed, moved) VALUES (?,?,?,?,?,?)", [by.id, by.name, keep.id, dupe.id, JSON.stringify(removed), JSON.stringify(moved)]);

    const [kept] = (await conn.query("SELECT * FROM patients WHERE id = ?", [keep.id]))[0];
    const total = Object.values(moved).reduce((s, n) => s + n, 0);
    return { patient: patientOut(kept), removed, moved, total, summary: Object.entries(moved).map(([k, n]) => `${k}: ${n}`).join("\n") || "No linked records" };
  });
}

export async function listMerges(keptId) {
  const rows = await query(`SELECT * FROM patient_merges ${keptId ? "WHERE kept_id = ?" : ""} ORDER BY id DESC LIMIT 200`, keptId ? [keptId] : []);
  return rows.map((r) => ({ id: String(r.id), at: r.at, by: r.by_name, keptId: r.kept_id, removedId: r.removed_id, removed: fromJson(r.removed), moved: fromJson(r.moved, {}) }));
}
