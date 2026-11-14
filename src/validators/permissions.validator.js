import { z } from "zod";
import { ACTIONS, MODULES } from "../config/permissions.js";

/** { Patients: { view: true, ... }, ... } with only known modules and actions. */
export const permissionsShape = z.record(z.string(), z.record(z.string(), z.boolean())).superRefine((p, ctx) => {
  for (const [m, acts] of Object.entries(p)) {
    if (!MODULES.includes(m)) ctx.addIssue({ code: "custom", message: `Unknown module ${m}` });
    for (const a of Object.keys(acts)) if (!ACTIONS.includes(a)) ctx.addIssue({ code: "custom", message: `Unknown action ${a}` });
  }
});
