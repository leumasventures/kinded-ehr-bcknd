import { Router } from "express";
import * as c from "../controllers/audit.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { requireAdmin } from "../middleware/permission.middleware.js";

const router = Router();
router.use(authenticate(), requireAdmin);

router.get("/", c.list);
router.get("/verify", c.verify);

export default router;
