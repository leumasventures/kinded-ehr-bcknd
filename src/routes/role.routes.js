import { Router } from "express";
import * as c from "../controllers/role.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { requireAdmin } from "../middleware/permission.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { roleBody } from "../validators/role.validator.js";

const router = Router();
router.use(authenticate());

router.get("/", c.list);
router.post("/", requireAdmin, validate(roleBody, "Check the role's details."), c.create);
router.put("/:id", requireAdmin, validate(roleBody, "Check the role's details."), c.update);
router.delete("/:id", requireAdmin, c.remove);

export default router;
