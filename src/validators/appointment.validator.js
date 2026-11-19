import { z } from "zod";
import { isoDate } from "./common.validator.js";

export const VISIT_TYPES = ["General consultation", "Follow-up", "Specialist", "Paediatric", "Antenatal", "Emergency"];
export const STATUSES = ["Scheduled", "Checked in", "In Progress", "Completed", "Cancelled", "No-show"];

/** Half-hour slots, 08:00 to 16:30 (the same ones the web app offers). */
export const SLOTS = Array.from({ length: 18 }, (_, i) => {
  const mins = 8 * 60 + i * 30;
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
});

const fields = {
  patientId: z.string().trim().min(1, "Choose a registered patient").max(20),
  doctor: z.string().trim().min(2, "Choose a doctor").max(120),
  date: isoDate,
  time: z.enum(SLOTS, { errorMap: () => ({ message: "Choose one of the half-hour slots between 08:00 and 16:30" }) }),
  type: z.enum(VISIT_TYPES, { errorMap: () => ({ message: "Choose a visit type" }) }),
  reason: z.string().trim().max(255).optional().or(z.literal("")),
};

export const createAppointmentBody = z.object(fields);
// patientId is fixed once booked: to move an appointment to someone else, cancel it and book a new one.
export const updateAppointmentBody = z.object({ doctor: fields.doctor, date: fields.date, time: fields.time, type: fields.type, reason: fields.reason }).partial();
export const statusBody = z.object({ status: z.enum(STATUSES, { errorMap: () => ({ message: "Choose a valid status" }) }) });
