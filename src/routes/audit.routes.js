import { Router } from "express";
import * as c from "../controllers/audit.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { requireAdmin } from "../middleware/permission.middleware.js";
import { clientAuditLimiter } from "../middleware/rateLimit.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { clientEntryBody } from "../validators/audit.validator.js";

const router = Router();

// Any signed-in person's browser may report what it did in not-yet-migrated modules. Reading the log is administrators only.
router.post("/client", clientAuditLimiter, authenticate(), validate(clientEntryBody, "Check the entry.", { issues: false }), c.clientEntry);

router.use(authenticate(), requireAdmin);
router.get("/", c.list);
router.get("/verify", c.verify);

export default router;
