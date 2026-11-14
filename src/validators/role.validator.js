import { z } from "zod";
import { permissionsShape } from "./permissions.validator.js";

export const roleBody = z.object({ name: z.string().trim().min(2).max(80), description: z.string().trim().max(255).default(""), permissions: permissionsShape });
