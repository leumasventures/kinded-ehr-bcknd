import { Router } from "express";
import * as c from "../controllers/dutyroster.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { requirePerm } from "../middleware/permission.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { createShiftsBody, updateShiftBody } from "../validators/roster.validator.js";

const router = Router();
router.use(authenticate());

router.get("/", c.list); // ?mine=1 for anyone; the whole roster needs Roster view (checked in the controller)
router.post("/", requirePerm("Roster", "create"), validate(createShiftsBody, "Check the shifts."), c.create);
router.put("/:id", requirePerm("Roster", "edit"), validate(updateShiftBody, "Check the shift."), c.update);
router.delete("/:id", requirePerm("Roster", "delete"), c.remove);
export default router;
