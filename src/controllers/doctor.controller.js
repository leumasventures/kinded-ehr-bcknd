import { notFound, wrap } from "../utils/errors.js";
import { audit } from "../services/audit.service.js";
import { createDoctor, deleteDoctor, doctorOut, getDoctorRow, listDoctors, setDoctorStatus, updateDoctor } from "../services/doctor.service.js";

export const list = wrap(async (_req, res) => res.json({ doctors: await listDoctors() }));

export const get = wrap(async (req, res) => {
  const row = await getDoctorRow(req.params.id);
  if (!row) throw notFound("Doctor not found.");
  res.json({ doctor: doctorOut(row) });
});

export const create = wrap(async (req, res) => {
  const doctor = await createDoctor(req.body, req.user.id);
  await audit(req, { action: "Create", module: "Doctors", summary: `Added ${doctor.name} (${doctor.id}) to the doctors' directory` });
  res.status(201).json({ doctor });
});

export const update = wrap(async (req, res) => {
  const row = await getDoctorRow(req.params.id);
  if (!row) throw notFound("Doctor not found.");
  const doctor = await updateDoctor(row, req.body);
  await audit(req, { action: "Update", module: "Doctors", summary: `Updated ${row.name} (${row.id}): ${Object.keys(req.body).join(", ") || "no changes"}` });
  res.json({ doctor });
});

export const changeStatus = wrap(async (req, res) => {
  const row = await getDoctorRow(req.params.id);
  if (!row) throw notFound("Doctor not found.");
  const doctor = await setDoctorStatus(row, req.body.status);
  await audit(req, { action: "Update", module: "Doctors", summary: `${row.name} (${row.id}): ${row.status} to ${req.body.status}` });
  res.json({ doctor });
});

export const remove = wrap(async (req, res) => {
  const row = await getDoctorRow(req.params.id);
  if (!row) throw notFound("Doctor not found.");
  await deleteDoctor(row);
  await audit(req, { action: "Delete", module: "Doctors", summary: `Removed ${row.name} (${row.id}) from the doctors' directory` });
  res.json({ ok: true });
});
