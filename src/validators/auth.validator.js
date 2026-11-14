import { z } from "zod";

export const loginBody = z.object({ email: z.string().trim().toLowerCase().email().max(190), password: z.string().min(1).max(200) });
export const refreshBody = z.object({ refreshToken: z.string().min(20).max(200) });
export const changePasswordBody = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().max(200) });
