import { Router } from "express";
import * as c from "../controllers/claims.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { requirePerm } from "../middleware/permission.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { approveClaimBody, claimPaymentBody, createClaimBody, rejectClaimBody, submitClaimBody } from "../validators/billing.validator.js";

const router = Router();
router.use(authenticate());

router.get("/", requirePerm("Billing", "view"), c.list);
router.get("/claimable", requirePerm("Billing", "view"), c.claimable);
router.get("/:id", requirePerm("Billing", "view"), c.get);
router.post("/", requirePerm("Billing", "create"), validate(createClaimBody, "Check the claim."), c.create);
router.post("/:id/submit", requirePerm("Billing", "edit"), validate(submitClaimBody, "Check the submission."), c.submit);
router.post("/:id/approve", requirePerm("Billing", "edit"), validate(approveClaimBody, "Enter the approved amount."), c.approve);
router.post("/:id/reject", requirePerm("Billing", "edit"), validate(rejectClaimBody, "Give the reason."), c.reject);
router.post("/:id/payments", requirePerm("Billing", "edit"), validate(claimPaymentBody, "Check the payment."), c.pay);
export default router;
