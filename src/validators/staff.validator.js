import { z } from "zod";
import { permissionsShape } from "./permissions.validator.js";

const fields = {
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(190),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  roleId: z.string().min(1).max(40),
  permissions: permissionsShape.nullable().optional(),
  active: z.boolean().optional(),
};

export const createStaffBody = z.object(fields);
export const updateStaffBody = z.object(fields).partial();
