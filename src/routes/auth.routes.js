import { Router } from "express";
import * as c from "../controllers/auth.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { loginLimiter, refreshLimiter } from "../middleware/rateLimit.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { changePasswordBody, loginBody, refreshBody } from "../validators/auth.validator.js";

const router = Router();
const pending = authenticate({ allowPendingPassword: true }); // these stay usable while a new password is still required

router.post("/login", loginLimiter, validate(loginBody, "Enter your email and password.", { issues: false }), c.login);
router.post("/refresh", refreshLimiter, validate(refreshBody, "Sign in again.", { status: 401, issues: false }), c.refresh);
router.post("/logout", pending, c.logout);
router.get("/me", pending, c.me);
router.post("/change-password", loginLimiter, pending, validate(changePasswordBody, "Enter your current and new password.", { issues: false }), c.changePassword);

export default router;
