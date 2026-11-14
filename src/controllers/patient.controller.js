import { conflict, notFound, wrap } from "../utils/errors.js";
import { audit } from "../services/audit.service.js";
import { countNotes, createPatient, deletePatientRow, findDuplicates, getPatientRow, patientOut, searchPatients, updatePatient } from "../services/patient.service.js";

export const list = wrap(async (req, res) => {
  const q = String(req.query.search ?? "").trim().slice(0, 80);
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const result = await searchPatients(q, limit, offset);
  if (req.emergency) await audit(req, { action: "View", module: "Emergency access", summary: `${req.user.name} searched the patient register in an emergency${q ? ` for "${q}"` : ""}` });
  res.json(result);
});

export const get = wrap(async (req, res) => {
  const row = await getPatientRow(req.params.id);
  if (!row) throw notFound("Patient not found.");
  await audit(req, req.emergency
    ? { action: "View", module: "Emergency access", summary: `${req.user.name} opened the record of ${row.name} (${row.id}) in an emergency` }
    : { action: "View", module: "Patients", summary: `Opened record of ${row.name} (${row.id})` });
  res.json({ patient: patientOut(row) });
});

export const create = wrap(async (req, res) => {
  const { allowDuplicate, ...d } = req.body;
  if (!allowDuplicate) {
    const duplicates = await findDuplicates(d);
    if (duplicates.length) throw conflict("This person may already be registered.", { code: "possible_duplicate", duplicates });
  }
  const row = await createPatient(d, req.user.id);
  await audit(req, { action: "Create", module: "Patients", summary: `Registered patient ${d.name} (${row.id})${allowDuplicate ? " after confirming a possible duplicate" : ""}` });
  res.status(201).json({ patient: patientOut(row) });
});

export const update = wrap(async (req, res) => {
  const { allowDuplicate, ...d } = req.body;
  const row = await getPatientRow(req.params.id);
  if (!row) throw notFound("Patient not found.");
  if (!allowDuplicate) {
    const duplicates = await findDuplicates(d, row.id);
    if (duplicates.length) throw conflict("This matches another registered patient.", { code: "possible_duplicate", duplicates });
  }
  const changed = await updatePatient(row, d);
  // Which fields changed, never their values.
  if (changed.length) await audit(req, { action: "Update", module: "Patients", summary: `Updated ${row.name} (${row.id}): ${changed.join(", ")}` });
  res.json({ patient: patientOut(await getPatientRow(row.id)) });
});

export const remove = wrap(async (req, res) => {
  const row = await getPatientRow(req.params.id);
  if (!row) throw notFound("Patient not found.");
  if ((await countNotes(row.id)) > 0) throw conflict("This patient has clinical notes on file. Clinical records are kept, so the patient can't be deleted.");
  await deletePatientRow(row.id);
  await audit(req, { action: "Delete", module: "Patients", summary: `Deleted patient ${row.name} (${row.id})` });
  res.json({ ok: true });
});
