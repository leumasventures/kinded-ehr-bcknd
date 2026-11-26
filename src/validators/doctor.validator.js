import { z } from "zod";

export const DOCTOR_STATUSES = ["Available", "In Surgery", "On Leave"];
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use the format HH:mm");

const fields = {
  name: z.string().trim().min(2, "Enter the doctor's name").max(120),
  specialty: z.string().trim().max(120).default(""),
  phone: z.string().trim().max(40).default(""),
  email: z.union([z.literal(""), z.string().trim().email("Enter a valid email").max(160)]).default(""),
  days: z.array(z.number().int().min(0).max(6)).min(1, "Choose at least one working day").max(7),
  start: hhmm,
  end: hhmm,
  status: z.enum(DOCTOR_STATUSES, { errorMap: () => ({ message: "Choose a valid status" }) }),
};
const ordered = (d) => d.start === undefined || d.end === undefined || d.start < d.end;
const orderedMsg = { message: "The shift must end after it starts", path: ["end"] };

export const createDoctorBody = z.object({ ...fields, status: fields.status.default("Available") }).refine(ordered, orderedMsg);
export const updateDoctorBody = z.object(fields).partial().refine(ordered, orderedMsg);
export const doctorStatusBody = z.object({ status: fields.status });
