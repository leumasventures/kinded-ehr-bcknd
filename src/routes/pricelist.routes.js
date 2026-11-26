import { Router } from "express";
import { authenticate, requirePerm, validate } from "./guards.js";
import * as c from "../controllers/pricelist.controller.js";
import { createSchema, updateSchema } from "../validators/pricelist.validator.js";

const r = Router();
r.use(authenticate());

// Order forms and the invoice screen need to read prices, so reading is open to any signed-in staff.
r.get("/", c.list);
r.get("/categories", c.categories); // before /:id
r.get("/:id", c.get);

// The price list page uses the Billing permissions. Taking an item off the list ("Delete" on the page) is an update
// with active: false, so it needs Billing "delete"; every other change needs Billing "edit".
const changePerm = (req, res, next) => (req.body?.active === false ? requirePerm("Billing", "delete") : requirePerm("Billing", "edit"))(req, res, next);

r.post("/", requirePerm("Billing", "create"), validate(createSchema), c.create);
r.put("/:id", changePerm, validate(updateSchema), c.update);
r.patch("/:id", changePerm, validate(updateSchema), c.update);

export default r;