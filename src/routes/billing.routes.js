import { Router } from "express";
import { authenticate, requirePerm, validate } from "./guards.js";
import * as c from "../controllers/billing.controller.js";
import { createSchema, paySchema } from "../validators/billing.validator.js";

const r = Router();
r.use(authenticate());

r.get("/", requirePerm("Billing", "view"), c.list);
r.get("/methods", requirePerm("Billing", "view"), c.methods); // before /:id
r.get("/:id", requirePerm("Billing", "view"), c.get);
r.post("/", requirePerm("Billing", "create"), validate(createSchema), c.create);
r.post("/:id/payments", requirePerm("Billing", "edit"), validate(paySchema), c.pay);

export default r;