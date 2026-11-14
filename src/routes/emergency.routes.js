import { Router } from "express";
import * as c from "../controllers/emergency.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { emergencyBody } from "../validators/emergency.validator.js";

const router = Router();
router.use(authenticate());

router.get("/", c.status);
router.post("/", validate(emergencyBody, null, { issues: false }), c.start);
router.delete("/", c.end);

export default router;
