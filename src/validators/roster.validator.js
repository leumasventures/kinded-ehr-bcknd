import { z } from "zod";
import { isoDate } from "./common.validator.js";

export const SHIFTS = ["Morning", "Afternoon", "Night", "On call", "Leave"];
export const UNITS = ["Outpatient (OPD)", "Emergency", "General Ward", "Maternity", "Pediatrics", "ICU", "Theatre", "Laboratory", "Pharmacy", "Accounts & Billing", "Administration"];
export const MAX_SPAN_DAYS = 63; // nine weeks

const entry = z.object({
  date: isoDate,
  staffId: z.string().trim().min(1, "Choose a staff member").max(40),
  shift: z.enum(SHIFTS, { errorMap: () => ({ message: "Choose a shift" }) }),
  unit: z.string().trim().max(60).default(""),
  note: z.string().trim().max(255).default(""),
});

export const createShiftsBody = z.object({
  entries: z.array(entry).min(1, "Add at least one shift").max(500, "That is too many shifts at once"),
  onConflict: z.enum(["fail", "skip"]).default("fail"),
});
export const updateShiftBody = z.object({ shift: entry.shape.shift, unit: entry.shape.unit, note: entry.shape.note }).partial();
