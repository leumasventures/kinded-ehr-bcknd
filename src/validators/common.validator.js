import { z } from "zod";

/** YYYY-MM-DD that is a real calendar day. Date.parse alone accepts 2030-02-31, so the date is rebuilt and compared. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "That date doesn't exist");
