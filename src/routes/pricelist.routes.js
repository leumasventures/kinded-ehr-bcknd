import { Router } from "express";
import { authenticate, allow, validate, ACCESS } from "./guards.js";
import * as c from "../controllers/pricelist.controller.js";
import { createSchema, updateSchema } from "../validators/pricelist.validator.js";

const r = Router();
r.use(authenticate());

// Order forms and the invoice screen need to read prices, so reading is open to any signed-in staff.
r.get("/", c.list);
r.get("/categories", c.categories); // before /:id
r.get("/:id", c.get);
// A price change affects every later invoice, so editing is limited.
r.post("/", allow(...ACCESS.priceList.edit), validate(createSchema), c.create);
r.patch("/:id", allow(...ACCESS.priceList.edit), validate(updateSchema), c.update);

export default r;