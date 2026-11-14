import { z } from "zod";
import { today } from "../services/patient.service.js";

const BLOOD = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Unknown"];
const GENO = ["AA", "AS", "SS", "AC", "SC", "Unknown"];
const PAYERS = ["Self-pay", "NHIA / NHIS", "HMO", "Corporate"];
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD").refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "That date doesn't exist");

export const patientBody = z.object({
  name: z.string().trim().min(2, "Enter the patient's full name").max(160),
  dob: isoDate.refine((s) => s <= today(), "Date of birth can't be in the future").refine((s) => s >= "1900-01-01", "Check the date of birth"),
  gender: z.enum(["Male", "Female"]),
  phone: z.string().trim().max(40).default(""),
  address: z.string().trim().max(255).default(""),
  bloodGroup: z.enum(BLOOD).default("Unknown"),
  genotype: z.enum(GENO).default("Unknown"),
  payer: z.enum(PAYERS).default("Self-pay"),
  payerName: z.string().trim().max(160).optional().or(z.literal("")),
  memberId: z.string().trim().max(80).optional().or(z.literal("")),
  allergies: z.string().trim().max(500).default(""),
  kinName: z.string().trim().max(160).default(""),
  kinRelation: z.string().trim().max(40).default(""),
  kinPhone: z.string().trim().max(40).default(""),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  allowDuplicate: z.boolean().optional(),
});
