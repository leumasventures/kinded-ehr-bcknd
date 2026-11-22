import { z } from "zod";

// Email, role and privileges are not here on purpose: only administrators change those (users.controller.js).
export const profileSchema = z
  .object({
    name: z.string().trim().min(1, "Enter your name.").max(120).optional(),
    phone: z.string().trim().max(30).regex(/^[+()\d\s-]*$/, "Use digits, spaces, +, - or brackets.").optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Nothing to update." });

// Length rules live in the controller so the message is the same wherever the password is changed.
export const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password.").max(1000),
  newPassword: z.string().min(1, "Choose a new password.").max(1000),
});