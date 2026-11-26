import { Router } from "express";
import * as c from "../controllers/admission.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { requirePerm } from "../middleware/permission.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { admitBody, dischargeBody, transferBody } from "../validators/admission.validator.js";

const router = Router();
router.use(authenticate());

router.get("/", requirePerm("Admissions", "view"), c.list);
router.get("/wards", requirePerm("Admissions", "view"), c.wards);
router.get("/:id", requirePerm("Admissions", "view"), c.get);
router.post("/", requirePerm("Admissions", "create"), validate(admitBody, "Check the admission details."), c.create);
router.post("/:id/transfer", requirePerm("Admissions", "edit"), validate(transferBody, "Choose a ward and bed."), c.move);
router.post("/:id/discharge", requirePerm("Admissions", "edit"), validate(dischargeBody, "Check the discharge details."), c.dischargePatient);
export default router;
