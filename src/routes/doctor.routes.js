import { Router } from "express";
import * as c from "../controllers/doctor.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { requirePerm } from "../middleware/permission.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { createDoctorBody, doctorStatusBody, updateDoctorBody } from "../validators/doctor.validator.js";

const router = Router();
router.use(authenticate());

// The directory is read by anyone signed in: doctor pickers on appointments, lab orders and admissions all need it.
router.get("/", c.list);
router.get("/:id", c.get);
router.post("/", requirePerm("Doctors", "create"), validate(createDoctorBody, "Check the doctor's details."), c.create);
router.put("/:id", requirePerm("Doctors", "edit"), validate(updateDoctorBody, "Check the doctor's details."), c.update);
router.post("/:id/status", requirePerm("Doctors", "edit"), validate(doctorStatusBody, "Choose a valid status."), c.changeStatus);
router.delete("/:id", requirePerm("Doctors", "delete"), c.remove);
export default router;
