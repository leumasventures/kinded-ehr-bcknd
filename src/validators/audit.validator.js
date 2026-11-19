import { z } from "zod";

// What the web app may report about itself (for modules that are not on the server yet). Sign-in, sign-out and security
// events are never accepted from the browser: the server writes those itself.
export const CLIENT_ACTIONS = ["View", "Create", "Update", "Delete", "Lock", "Unlock", "Void", "Payment", "Export"];

export const clientEntryBody = z.object({
  action: z.enum(CLIENT_ACTIONS),
  module: z.string().trim().min(1).max(60),
  summary: z.string().trim().min(1).max(300),
  detail: z.string().max(1000).optional(),
  outcome: z.enum(["success", "failure"]).optional(),
});
