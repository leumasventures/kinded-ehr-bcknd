import { Router } from "express";
import { authenticate, allow, validate, ACCESS } from "./guards.js";
import * as c from "../controllers/laboratory.controller.js";
import { cancelSchema, orderSchema, resultsSchema } from "../validators/laboratory.validator.js";

const L = ACCESS.laboratory;
const r = Router();
r.use(authenticate());

r.get("/", allow(...L.read), c.list);
r.get("/tests", allow(...L.read, ...L.order), c.tests); // before /:id
r.get("/:id", allow(...L.read), c.get);
r.post("/", allow(...L.order), validate(orderSchema), c.create);
r.post("/:id/collect", allow(...L.collect), c.collect);
r.post("/:id/results", allow(...L.result), validate(resultsSchema), c.results);
r.post("/:id/review", allow(...L.review), c.review);
r.post("/:id/cancel", allow(...L.cancel), validate(cancelSchema), c.cancel);

export default r;