import { z } from "zod";

export const MIN_REASON = 15;
export const emergencyBody = z.object({ reason: z.string().trim().min(MIN_REASON, `Explain the emergency in at least ${MIN_REASON} characters.`).max(500) });
