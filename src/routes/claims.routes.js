import { Router } from "express";
import { authenticate, requirePerm, validate } from "./guards.js";
import * as c from "../controllers/claims.controller.js";
import { approveSchema, createSchema, paySchema, rejectSchema, submitSchema } from "../validators/claims.validator.js";

const r = Router();
r.use(authenticate());

// There is no separate Claims module in the permission grid, so claims follow Billing...
r.get("/", requirePerm("Billing", "view"), c.list);
r.get("/claimable", requirePerm("Billing", "view"), c.claimable); // before /:id
r.get("/:id", requirePerm("Billing", "view"), c.get);
r.post("/", requirePerm("Billing", "create"), validate(createSchema), c.create);
r.post("/:id/submit", requirePerm("Billing", "create"), validate(submitSchema), c.submit);
// ...except the steps that change what the hospital is owed, which need Accounts access (the Accountant role).
r.post("/:id/approve", requirePerm("Accounts", "edit"), validate(approveSchema), c.approve);
r.post("/:id/reject", requirePerm("Accounts", "edit"), validate(rejectSchema), c.reject);
r.post("/:id/payments", requirePerm("Accounts", "edit"), validate(paySchema), c.pay);

export default r;