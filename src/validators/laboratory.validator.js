import { z } from "zod";

export const STATUSES = ["Ordered", "Collected", "Resulted", "Cancelled"];
export const PRIORITIES = ["Routine", "Urgent", "Stat"];
export const FLAGS = ["Normal", "Low", "High", "Critical"];

const blank = (v) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const opt = (max) => z.preprocess(blank, z.string().trim().max(max).optional());

// testIds are ids of laboratory items on the price list; the name and price are copied from there.
export const orderSchema = z.object({
  patientId: z.string().trim().min(1, "Choose a patient.").max(20),
  priority: z.enum(PRIORITIES, { message: "Choose the priority." }).default("Routine"),
  clinicalNotes: opt(1000),
  testIds: z.array(z.string().trim().min(1)).min(1, "Choose at least one test.").max(30, "An order can have at most 30 tests."),
});

export const resultsSchema = z.object({
  results: z
    .array(
      z.object({
        testId: z.coerce.number({ message: "Missing test." }).int().positive(),
        value: z.string().trim().min(1, "Enter a result for every test.").max(500),
        unit: opt(30),
        referenceRange: opt(80),
        flag: z.enum(FLAGS, { message: "Choose Normal, Low, High or Critical for every result." }),
      })
    )
    .min(1, "Enter the results."),
});

export const cancelSchema = z.object({ reason: z.string().trim().min(1, "Give the reason for cancelling.").max(255) });