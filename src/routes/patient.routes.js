import { Router } from "express";
import * as c from "../controllers/patient.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { requirePerm } from "../middleware/permission.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { patientBody } from "../validators/patient.validator.js";

const router = Router();
router.use(authenticate());

router.get("/", requirePerm("Patients", "view"), c.list);
router.get("/stats", requirePerm("Patients", "view"), c.stats); // before /:id
router.get("/:id", requirePerm("Patients", "view"), c.get);
router.get("/:id/summary", requirePerm("Patients", "view"), c.summary);
router.post("/", requirePerm("Patients", "create"), validate(patientBody, "Check the patient's details."), c.create);
router.put("/:id", requirePerm("Patients", "edit"), validate(patientBody, "Check the patient's details."), c.update);
router.delete("/:id", requirePerm("Patients", "delete"), c.remove);

export default router;