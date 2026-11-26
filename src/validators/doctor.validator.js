import { z } from "zod";

export const profileBody = z
  .object({
    specialty: z.string().max(80).optional(),
    days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    start: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    end: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    status: z.enum(["Available", "Not Onseat", "On Leave"]).optional(),
  })
  .strict();
