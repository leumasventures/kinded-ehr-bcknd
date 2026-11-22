import { wrap } from "../utils/errors.js";
import { listAppointments } from "../services/appointment.service.js";
import { listAdmissions } from "../services/admission.service.js";
import { listOrders } from "../services/laboratory.service.js";

// The signed-in doctor's own working view. It only gathers what other modules already own (appointments, admissions,
// laboratory), always scoped to this doctor, and reads without changing anything, so there is nothing to audit here.
// Acting on an item goes through that module: appointments (status), admissions (discharge), laboratory (review).

const todayISO = () => new Date().toISOString().slice(0, 10);
const DONE = ["Cancelled", "No-show"];

export const workspace = wrap(async (req, res) => {
  const date = todayISO();
  const [booked, admitted, unreviewed] = await Promise.all([
    // ASSUMPTION: appointments store the doctor as a name, matching users.name (the appointment controller prints a.doctor).
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
    counts: { appointments: appointments.length, admitted: admitted.length, resultsToReview: unreviewed.length, criticalResults: unreviewed.filter((o) => o.critical).length },
  });
});

// Lab results ordered by this doctor that nobody has reviewed yet. Critical ones come first.
export const results = wrap(async (req, res) => {
  const orders = await listOrders({ orderedBy: req.user.id, unreviewed: true, limit: req.query.limit });
  res.json({ orders: [...orders].sort((a, b) => Number(b.critical) - Number(a.critical)) });
});