import { Router } from "express";
import * as c from "../controllers/admin.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { requireAdmin } from "../middleware/permission.middleware.js";

const router = Router();
router.use(authenticate());
router.use(requireAdmin);
router.get("/dashboard", c.getDashboard);
export default router;
