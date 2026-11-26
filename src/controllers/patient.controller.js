import { conflict, notFound, wrap } from "../utils/errors.js";
import { audit } from "../services/audit.service.js";
import { countForPatient, listAppointments } from "../services/appointment.service.js";
import { countInvoicesFor, listInvoices } from "../services/billing.service.js";
import { listAdmissions } from "../services/admission.service.js";
import { listOrders } from "../services/laboratory.service.js";
import { listPrescriptions } from "../services/pharmacy.service.js";
import { countNotes, countOtherRecords, createPatient, deletePatientRow, findDuplicates, getPatientRow, patientOut, patientStats, searchPatients, updatePatient } from "../services/patient.service.js";

const GENDERS = ["Male", "Female"];
const PAYERS = ["Self-pay", "NHIA / NHIS", "HMO", "Corporate"];

export const list = wrap(async (req, res) => {
  const q = String(req.query.search ?? "").trim().slice(0, 80);
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const gender = GENDERS.includes(String(req.query.gender)) ? String(req.query.gender) : undefined;
  const payer = PAYERS.includes(String(req.query.payer)) ? String(req.query.payer) : undefined;
  const hasAllergies = req.query.hasAllergies === "1" || req.query.hasAllergies === "true";
  const result = await searchPatients(q, limit, offset, { gender, payer, hasAllergies });
  if (req.emergency) await audit(req, { action: "View", module: "Emergency access", summary: `${req.user.name} searched the patient register in an emergency${q ? ` for "${q}"` : ""}` });
  res.json(result);
});

// The numbers above the list: registered, new this month, on a ward now, with known allergies.
export const stats = wrap(async (_req, res) => res.json(await patientStats()));

export const get = wrap(async (req, res) => {
  const row = await getPatientRow(req.params.id);
  if (!row) throw notFound("Patient not found.");
  await audit(req, req.emergency
    ? { action: "View", module: "Emergency access", summary: `${req.user.name} opened the record of ${row.name} (${row.id}) in an emergency` }
    : { action: "View", module: "Patients", summary: `Opened record of ${row.name} (${row.id})` });
  res.json({ patient: patientOut(row) });
});

/**
 * What the patient chart shows about the rest of the hospital. Each section is only included when the person may view that
 * module (their role or personal privileges), so opening a patient never reveals billing or lab data to someone without access.
 * The record itself, and the audit entry for opening it, come from `get`.
 */
export const summary = wrap(async (req, res) => {
  const row = await getPatientRow(req.params.id);
  if (!row) throw notFound("Patient not found.");
  const can = (module) => !!req.user.permissions[module]?.view;
  const patientId = row.id;
  const [appointments, admissions, labOrders, invoices, prescriptions] = await Promise.all([
    can("Appointments") ? listAppointments({ patientId, limit: 20 }) : undefined,
    can("Admissions") ? listAdmissions({ patientId, limit: 20 }) : undefined,
    can("Laboratory") ? listOrders({ patientId, limit: 20 }) : undefined,
    can("Billing") ? listInvoices({ patientId, limit: 20 }) : undefined,
    can("Pharmacy") ? listPrescriptions({ patientId, limit: 20 }) : undefined,
  ]);
  res.json({ summary: { appointments, admissions, labOrders, invoices, prescriptions } });
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
  if ((await countForPatient(row.id)) > 0) throw conflict("This patient has appointments on file, so the patient can't be deleted.");
  if ((await countInvoicesFor(row.id)) > 0) throw conflict("This patient has invoices on file, so the patient can't be deleted.");
  if ((await countOtherRecords(row.id)) > 0) throw conflict("This patient has ward, laboratory, pharmacy or nursing records on file, so the patient can't be deleted.");
  await deletePatientRow(row.id);
  await audit(req, { action: "Delete", module: "Patients", summary: `Deleted patient ${row.name} (${row.id})` });
  res.json({ ok: true });
});