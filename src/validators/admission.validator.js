import { z } from "zod";
import { isoDate } from "./common.validator.js";

export const WARDS = [
  { name: "General Ward", prefix: "G", beds: 30 },
  { name: "Maternity", prefix: "M", beds: 15 },
  { name: "Pediatrics", prefix: "P", beds: 20 },
  { name: "ICU", prefix: "I", beds: 8 },
];
export const OUTCOMES = ["Recovered / improved", "Referred to another facility", "Discharged against medical advice", "Deceased"];
export const wardNamed = (n) => WARDS.find((w) => w.name === n);
export const bedsOf = (ward) => {
  const w = wardNamed(ward);
  return w ? Array.from({ length: w.beds }, (_, i) => `${w.prefix}-${String(i + 1).padStart(2, "0")}`) : [];
};

const ward = z.string().refine((w) => !!wardNamed(w), "Choose a ward");
const bed = z.string().trim().min(1, "Choose a bed").max(10);

export const admitBody = z.object({
  patientId: z.string().trim().min(1, "Choose a registered patient").max(20),
  ward,
  bed,
  doctor: z.string().trim().min(2, "Choose a doctor").max(120),
  diagnosis: z.string().trim().max(255).default(""),
  admittedOn: isoDate.optional(),
});
export const transferBody = z.object({ ward, bed });
export const dischargeBody = z.object({
  outcome: z.enum(OUTCOMES, { errorMap: () => ({ message: "Choose an outcome" }) }),
  notes: z.string().trim().max(500).default(""),
  dischargedOn: isoDate.optional(),
});
