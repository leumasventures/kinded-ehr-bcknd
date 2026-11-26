import { Router } from "express";
import { authenticate, validate } from "./guards.js";
import * as c from "../controllers/account.controller.js";
import { passwordSchema, profileSchema } from "../validators/account.validator.js";

const r = Router();

r.get("/", authenticate(), c.me);
r.put("/", authenticate(), validate(profileSchema), c.updateProfile);
r.patch("/", authenticate(), validate(profileSchema), c.updateProfile);
// Someone forced to choose a new password must be able to reach this, so it lets a pending-password account through.
r.post("/password", authenticate({ allowPendingPassword: true }), validate(passwordSchema), c.changePassword);

export default r;