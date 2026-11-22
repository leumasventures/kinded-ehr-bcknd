import { z } from "zod";

const blank = (v) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const opt = (max) => z.preprocess(blank, z.string().trim().max(max).optional());
const int = (min, max, what) => z.preprocess(blank, z.coerce.number({ message: `Enter ${what} as a number.` }).int(`${what} must be a whole number.`).min(min, `${what} looks too low.`).max(max, `${what} looks too high.`).optional());
const dec = (min, max, what) => z.preprocess(blank, z.coerce.number({ message: `Enter ${what} as a number.` }).min(min, `${what} looks too low.`).max(max, `${what} looks too high.`).transform((v) => Math.round(v * 10) / 10).optional());
const patientId = z.string().trim().min(1, "Choose a patient.").max(20);

// The ranges only reject typing slips (a pulse of 800); whether a value is worrying is flagged separately, as alerts.
export const vitalsSchema = z
  .object({
    patientId,
    tempC: dec(30, 45, "The temperature"),
    pulse: int(20, 300, "The pulse"),
    respRate: int(4, 80, "The respiratory rate"),
    bpSys: int(40, 300, "The systolic pressure"),
    bpDia: int(20, 200, "The diastolic pressure"),
    spo2: int(50, 100, "The oxygen saturation"),
    weightKg: dec(0.3, 500, "The weight"),
    notes: opt(255),
  })
  .refine((v) => [v.tempC, v.pulse, v.respRate, v.bpSys, v.bpDia, v.spo2, v.weightKg].some((x) => x !== undefined), { message: "Enter at least one measurement." })
  .refine((v) => v.bpSys === undefined || v.bpDia === undefined || v.bpSys > v.bpDia, { message: "The systolic pressure must be higher than the diastolic.", path: ["bpSys"] })
  .refine((v) => (v.bpSys === undefined) === (v.bpDia === undefined), { message: "Enter both blood pressure numbers, or neither.", path: ["bpDia"] });

export const noteSchema = z.object({ patientId, note: z.string().trim().min(1, "Write the note.").max(4000, "That note is too long. Split it into two.") });