import { z } from "zod";

export const SHIFTS = ["Morning", "Afternoon", "Night", "On call", "Leave"];

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date format YYYY-MM-DD.");
const blankToNull = (v) => (typeof v === "string" && v.trim() === "" ? null : v);
const optNull = (max) => z.preprocess(blankToNull, z.string().trim().max(max).nullish());
const staffId = z.string().trim().min(1, "Choose a staff member.").max(40);
const shift = z.enum(SHIFTS, { message: "Choose a valid shift." });

export const createSchema = z.object({ staffId, date: day, shift, department: optNull(60), notes: optNull(255) });

// null clears department or notes; leaving a key out leaves it as it is.
export const updateSchema = z
  .object({ date: day.optional(), shift: shift.optional(), department: optNull(60), notes: optNull(255) })
  .refine((d) => Object.keys(d).length > 0, { message: "Nothing to update." });

// One call for the usual weekly job: these people, on these dates, for this shift.
export const assignSchema = z
  .object({
    staffIds: z.array(staffId).min(1, "Choose at least one person.").max(50),
    dates: z.array(day).min(1, "Choose at least one date.").max(31),
    shift,
    department: optNull(60),
  })
  .refine((d) => d.staffIds.length * d.dates.length <= 500, { message: "That is too many shifts at once. Split it up." });
