import { bad, conflict, notFound, wrap } from "../utils/errors.js";
import { audit } from "../services/audit.service.js";
import { getPatientRow } from "../services/patient.service.js";
import { admissionOut, createAdmission, dischargeAdmission, doctorExists, getAdmission, listAdmissions, updateAdmission, wardCensus } from "../services/admission.service.js";
import { STATUSES } from "../validators/admission.validator.js";

const who = (a) => `${a.patient_name} (${a.patient_id})`;
const where = (a) => [a.ward, a.bed && `bed ${a.bed}`].filter(Boolean).join(", ") || "no bed assigned";
// The reason for admission, the discharge summary and the outcome are clinical, so they are never written to the audit log.

export const list = wrap(async (req, res) => {
  const { status, ward, doctorId, patientId } = req.query;
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
  const admissions = await listAdmissions({
    status: STATUSES.includes(String(status)) ? String(status) : undefined,
    ward: ward ? String(ward).slice(0, 60) : undefined,
    doctorId: doctorId ? String(doctorId).slice(0, 40) : undefined,
    patientId: patientId ? String(patientId).slice(0, 20) : undefined,
    limit,
  });
  res.json({ admissions });
});

// Beds in use per ward right now.
export const census = wrap(async (_req, res) => res.json({ wards: await wardCensus() }));

export const get = wrap(async (req, res) => {
  const row = await getAdmission(req.params.id);
  if (!row) throw notFound("Admission not found.");
  res.json({ admission: admissionOut(row) });
});

export const create = wrap(async (req, res) => {
  // The name is read from the register, never typed in.
  if (!(await getPatientRow(req.body.patientId))) throw bad("That patient isn't registered. Register the patient first.");
  if (req.body.doctorId && !(await doctorExists(req.body.doctorId))) throw bad("That doctor doesn't exist or isn't active.");
  const row = await createAdmission(req.body, req.user.id);
  await audit(req, { action: "Create", module: "Admissions", summary: `Admitted ${who(row)} to ${where(row)}` });
  res.status(201).json({ admission: admissionOut(row) });
});

export const update = wrap(async (req, res) => {
  const row = await getAdmission(req.params.id);
  if (!row) throw notFound("Admission not found.");
  if (row.status !== "Admitted") throw conflict("A discharged patient's admission can't be changed.");
  if (req.body.doctorId && !(await doctorExists(req.body.doctorId))) throw bad("That doctor doesn't exist or isn't active.");
  const changed = await updateAdmission(row, req.body);
  if (changed.length) {
    const after = await getAdmission(row.id);
    const moved = changed.includes("ward") || changed.includes("bed");
    await audit(req, { action: "Update", module: "Admissions", summary: `Updated admission of ${who(row)}: ${changed.join(", ")}${moved ? `; moved from ${where(row)} to ${where(after)}` : ""}` });
  }
  res.json({ admission: admissionOut(await getAdmission(row.id)) });
});

export const discharge = wrap(async (req, res) => {
  const row = await getAdmission(req.params.id);
  if (!row) throw notFound("Admission not found.");
  if (row.status !== "Admitted") throw conflict("This patient has already been discharged.");
  await dischargeAdmission(row, req.body);
  await audit(req, { action: "Update", module: "Admissions", summary: `Discharged ${who(row)} from ${where(row)}` });
  res.json({ admission: admissionOut(await getAdmission(row.id)) });
});

// There is no delete: an admission is part of the patient's record. Use update to correct it.