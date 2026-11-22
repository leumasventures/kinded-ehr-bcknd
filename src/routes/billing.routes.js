import { Router } from "express";
import { authenticate, allow, validate, ACCESS } from "./guards.js";
import * as c from "../controllers/billing.controller.js";
import { createSchema, paySchema } from "../validators/billing.validator.js";

const B = ACCESS.billing;
const r = Router();
r.use(authenticate());

r.get("/", allow(...B.read), c.list);
r.get("/methods", allow(...B.read), c.methods); // before /:id
r.get("/:id", allow(...B.read), c.get);
r.post("/", allow(...B.write), validate(createSchema), c.create);
r.post("/:id/payments", allow(...B.write), validate(paySchema), c.pay);

export default r;