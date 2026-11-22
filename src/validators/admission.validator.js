import { z } from "zod";

export const STATUSES = ["Admitted", "Discharged"];
export const OUTCOMES = ["Recovered", "Improved", "Referred", "Left against advice", "Deceased"];

const blank = (v) => (typeof v === "string" && v.trim() === "" ? null : v);
const opt = (max) => z.preprocess(blank, z.string().trim().max(max).nullish());
const reason = z.string().trim().min(1, "Give the reason for admission.").max(2000);
const bedNeedsWard = { message: "Choose a ward for that bed.", path: ["bed"] };

export const createSchema = z
  .object({
    patientId: z.string().trim().min(1, "Choose a patient.").max(20),
    doctorId: opt(40),
    ward: opt(60),
    bed: opt(30),
    reason,
  })
  .refine((d) => !d.bed || d.ward, bedNeedsWard);

export const updateSchema = z
  .object({ doctorId: opt(40), ward: opt(60), bed: opt(30), reason: reason.optional() })
  .refine((d) => Object.keys(d).length > 0, { message: "Nothing to update." });

export const dischargeSchema = z.object({
  outcome: z.enum(OUTCOMES, { message: "Choose the outcome." }),
  summary: opt(4000),
});