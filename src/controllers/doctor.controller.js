import { wrap, notFound } from "../utils/errors.js";
import { audit } from "../services/audit.service.js";
import { listAppointments } from "../services/appointment.service.js";
import { listAdmissions } from "../services/admission.service.js";
import { listOrders } from "../services/laboratory.service.js";
import { getDoctor, listDoctors, upsertProfile } from "../services/doctor.service.js";

// The signed-in doctor's own working view. It only gathers what other modules already own (appointments, admissions,
// laboratory), always scoped to this doctor, and reads without changing anything, so there is nothing to audit here.
// Acting on an item goes through that module: appointments (status), admissions (discharge), laboratory (review).

const todayISO = () => new Date().toISOString().slice(0, 10);
const DONE = ["Cancelled", "No-show"];

export const workspace = wrap(async (req, res) => {
  const date = todayISO();
  const [booked, admitted, unreviewed] = await Promise.all([
    listAppointments({ date, doctor: req.user.name, limit: 100 }),
    listAdmissions({ status: "Admitted", doctorId: req.user.id, limit: 100 }),
    listOrders({ orderedBy: req.user.id, unreviewed: true, limit: 50 }),
  ]);
  const appointments = booked.filter((a) => !DONE.includes(a.status));
  res.json({
    date,
    appointments,
    admitted,
    results: unreviewed,
    counts: {
      appointments: appointments.length,
      admitted: admitted.length,
      resultsToReview: unreviewed.length,
      criticalResults: unreviewed.filter((o) => o.critical).length,
    },
  });
});

export const results = wrap(async (req, res) => {
  const orders = await listOrders({ orderedBy: req.user.id, unreviewed: true, limit: req.query.limit });
  res.json({ orders: [...orders].sort((a, b) => Number(b.critical) - Number(a.critical)) });
});

export const list = wrap(async (_req, res) => {
  res.json({ doctors: await listDoctors() });
});

export const get = wrap(async (req, res) => {
  const doctor = await getDoctor(req.params.id);
  if (!doctor) throw notFound("Doctor not found.");
  res.json({ doctor });
});

export const upsert = wrap(async (req, res) => {
  const doctor = await upsertProfile(req.params.id, req.body);
  await audit(req, {
    action: "Update",
    module: "Doctors",
    summary: `Updated doctor profile for ${doctor.name} (${doctor.id})`,
  });
  res.json({ doctor });
});
