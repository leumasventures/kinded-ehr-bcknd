import { Router } from "express";
import { authenticate, requirePerm, validate } from "./guards.js";
import * as c from "../controllers/laboratory.controller.js";
import { cancelSchema, orderSchema, resultsSchema } from "../validators/laboratory.validator.js";

const r = Router();
r.use(authenticate());

r.get("/", requirePerm("Laboratory", "view"), c.list);
r.get("/tests", requirePerm("Laboratory", "view"), c.tests); // before /:id
r.get("/:id", requirePerm("Laboratory", "view"), c.get);
r.post("/", requirePerm("Laboratory", "create"), validate(orderSchema), c.create);
// Collecting, resulting, reviewing and cancelling all change an order, so they need Laboratory "edit".
r.post("/:id/collect", requirePerm("Laboratory", "edit"), c.collect);
r.post("/:id/results", requirePerm("Laboratory", "edit"), validate(resultsSchema), c.results);
r.post("/:id/review", requirePerm("Laboratory", "edit"), c.review);
r.post("/:id/cancel", requirePerm("Laboratory", "edit"), validate(cancelSchema), c.cancel);

export default r;