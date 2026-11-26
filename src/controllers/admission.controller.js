import { notFound, wrap } from "../utils/errors.js";
import { audit } from "../services/audit.service.js";
import { admissionOut, admit, discharge, getAdmissionRow, history, listAdmissions, occupancy, transfer } from "../services/admission.service.js";

export const list = wrap(async (req, res) => {
  const { status, ward, patientId } = req.query;
  res.json({
    admissions: await listAdmissions({
      status: status === "Admitted" || status === "Discharged" ? status : undefined,
      ward: ward ? String(ward).slice(0, 40) : undefined,
      patientId: patientId ? String(patientId).slice(0, 20) : undefined,
      limit: req.query.limit,
    }),
  });
});

export const wards = wrap(async (_req, res) => res.json({ wards: await occupancy() }));

export const get = wrap(async (req, res) => {
  const row = await getAdmissionRow(req.params.id);
  if (!row) throw notFound("Admission not found.");
  res.json({ admission: admissionOut(row), moves: await history(row.id) });
});

// Diagnosis and discharge notes are clinical, so they are never written to the audit log.
export const create = wrap(async (req, res) => {
  const admission = await admit(req.body, req.user);
  await audit(req, { action: "Create", module: "Admissions", summary: `Admitted ${admission.patient} (${admission.patientId}) to ${admission.ward}, bed ${admission.bed}, under ${admission.doctor}` });
  res.status(201).json({ admission });
});

export const move = wrap(async (req, res) => {
  const before = await getAdmissionRow(req.params.id);
  if (!before) throw notFound("Admission not found.");
  const admission = await transfer(before.id, req.body, req.user);
  await audit(req, { action: "Update", module: "Admissions", summary: `Moved ${before.patient_name} (${before.patient_id}) from ${before.ward} ${before.bed} to ${admission.ward} ${admission.bed}` });
  res.json({ admission });
});

export const dischargePatient = wrap(async (req, res) => {
  const before = await getAdmissionRow(req.params.id);
  if (!before) throw notFound("Admission not found.");
  const admission = await discharge(before.id, req.body);
  await audit(req, { action: "Update", module: "Admissions", summary: `Discharged ${before.patient_name} (${before.patient_id}) from ${before.ward} ${before.bed}: ${req.body.outcome}` });
  res.json({ admission });
});
