import { Router } from "express";
import * as c from "../controllers/staff.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { requireAdmin } from "../middleware/permission.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { createStaffBody, updateStaffBody } from "../validators/staff.validator.js";

const router = Router();
router.use(authenticate(), requireAdmin);

router.get("/", c.list);
router.post("/", validate(createStaffBody, "Check the user's details."), c.create);
router.put("/:id", validate(updateStaffBody, "Check the user's details."), c.update);
router.post("/:id/reset-password", c.resetPassword);
router.delete("/:id", c.remove);

export default router;
