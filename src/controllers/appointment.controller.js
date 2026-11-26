import { bad, conflict, notFound, wrap } from "../utils/errors.js";
import { audit } from "../services/audit.service.js";
import { TRANSITIONS, appointmentOut, countNotesFor, createAppointment, deleteAppointmentRow, getAppointment, listAppointments, setStatus, updateAppointment } from "../services/appointment.service.js";
import { getPatientRow } from "../services/patient.service.js";
import { assertDoctor } from "../services/doctor.service.js";
import { STATUSES } from "../validators/appointment.validator.js";

const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ""));
const what = (a) => `${a.patient_name ?? a.patientName ?? a.patient} (${a.patient_id}) with ${a.doctor} on ${a.appt_date} at ${a.appt_time}`;
// The reason for the visit is clinical, so it is never written to the audit log.

export const list = wrap(async (req, res) => {
  const { date, from, to, doctor, patientId, status } = req.query;
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
  const appointments = await listAppointments({
    date: isDay(date) ? date : undefined,
    from: isDay(from) ? from : undefined,
    to: isDay(to) ? to : undefined,
    doctor: doctor ? String(doctor).slice(0, 120) : undefined,
    patientId: patientId ? String(patientId).slice(0, 20) : undefined,
    status: STATUSES.includes(String(status)) ? String(status) : undefined,
    limit,
  });
  res.json({ appointments });
});

export const get = wrap(async (req, res) => {
  const row = await getAppointment(req.params.id);
  if (!row) throw notFound("Appointment not found.");
  res.json({ appointment: appointmentOut(row) });
});

export const create = wrap(async (req, res) => {
  // Every appointment belongs to a registered patient; the name is read from the register, never typed in.
  if (!(await getPatientRow(req.body.patientId))) throw bad("That patient isn't registered. Register the patient first.");
  await assertDoctor(req.body.doctor);
  const row = await createAppointment(req.body, req.user.id);
  await audit(req, { action: "Create", module: "Appointments", summary: `Booked ${what(row)}` });
  res.status(201).json({ appointment: appointmentOut(row) });
});

export const update = wrap(async (req, res) => {
  const row = await getAppointment(req.params.id);
  if (!row) throw notFound("Appointment not found.");
  if (row.status !== "Scheduled" && row.status !== "Checked in") throw conflict(`A ${row.status.toLowerCase()} appointment can't be changed. Book a new one instead.`);
  if (req.body.doctor && req.body.doctor !== row.doctor) await assertDoctor(req.body.doctor);
  const changed = await updateAppointment(row, req.body);
  if (changed.length) await audit(req, { action: "Update", module: "Appointments", summary: `Updated appointment ${row.id} of ${row.patient_name} (${row.patient_id}): ${changed.join(", ")}` });
  res.json({ appointment: appointmentOut(await getAppointment(row.id)) });
});

export const changeStatus = wrap(async (req, res) => {
  const { status } = req.body;
  const row = await getAppointment(req.params.id);
  if (!row) throw notFound("Appointment not found.");
  if (status === row.status) return res.json({ appointment: appointmentOut(row) });
  if (!TRANSITIONS[row.status].includes(status)) throw conflict(`An appointment that is ${row.status.toLowerCase()} can't be marked ${status.toLowerCase()}.`);
  await setStatus(row, status);
  await audit(req, { action: "Update", module: "Appointments", summary: `Appointment ${row.id} of ${row.patient_name} (${row.patient_id}): ${row.status} to ${status}` });
  res.json({ appointment: appointmentOut(await getAppointment(row.id)) });
});

export const remove = wrap(async (req, res) => {
  const row = await getAppointment(req.params.id);
  if (!row) throw notFound("Appointment not found.");
  if (!["Scheduled", "Cancelled", "No-show"].includes(row.status)) throw conflict(`A ${row.status.toLowerCase()} appointment is part of the record and can't be deleted.`);
  if ((await countNotesFor(row.id)) > 0) throw conflict("Clinical notes are linked to this appointment, so it can't be deleted.");
  await deleteAppointmentRow(row.id);
  await audit(req, { action: "Delete", module: "Appointments", summary: `Deleted appointment ${row.id} of ${row.patient_name} (${row.patient_id}) on ${row.appt_date} at ${row.appt_time}` });
  res.json({ ok: true });
});
