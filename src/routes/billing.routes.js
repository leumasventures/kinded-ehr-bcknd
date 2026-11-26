import { Router } from "express";
import * as c from "../controllers/billing.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { requirePerm } from "../middleware/permission.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { createInvoiceBody, paymentBody } from "../validators/billing.validator.js";

const router = Router();
router.use(authenticate());

router.get("/", requirePerm("Billing", "view"), c.list);
router.get("/invoices", requirePerm("Billing", "view"), c.list);
router.get("/totals", requirePerm("Billing", "view"), c.totals);
router.get("/invoices/:id", requirePerm("Billing", "view"), c.get);
router.post("/invoices", requirePerm("Billing", "create"), validate(createInvoiceBody, "Check the invoice."), c.create);
router.post("/invoices/:id/payments", requirePerm("Billing", "edit"), validate(paymentBody, "Check the payment."), c.pay);
export default router;
