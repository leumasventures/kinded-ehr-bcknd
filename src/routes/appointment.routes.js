import { Router } from "express";
import * as c from "../controllers/appointment.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { requirePerm } from "../middleware/permission.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { createAppointmentBody, statusBody, updateAppointmentBody } from "../validators/appointment.validator.js";

const router = Router();
router.use(authenticate());

router.get("/", requirePerm("Appointments", "view"), c.list);
router.get("/:id", requirePerm("Appointments", "view"), c.get);
router.post("/", requirePerm("Appointments", "create"), validate(createAppointmentBody, "Check the appointment details."), c.create);
router.put("/:id", requirePerm("Appointments", "edit"), validate(updateAppointmentBody, "Check the appointment details."), c.update);
router.post("/:id/status", requirePerm("Appointments", "edit"), validate(statusBody, "Choose a valid status."), c.changeStatus);
router.delete("/:id", requirePerm("Appointments", "delete"), c.remove);

export default router;
