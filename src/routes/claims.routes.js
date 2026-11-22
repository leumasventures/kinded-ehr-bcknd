import { Router } from "express";
import { authenticate, allow, validate, ACCESS } from "./guards.js";
import * as c from "../controllers/claims.controller.js";
import { approveSchema, createSchema, paySchema, rejectSchema, submitSchema } from "../validators/claims.validator.js";

const C = ACCESS.claims;
const r = Router();
r.use(authenticate());

r.get("/", allow(...C.work), c.list);
r.get("/claimable", allow(...C.work), c.claimable); // before /:id
r.get("/:id", allow(...C.work), c.get);
r.post("/", allow(...C.work), validate(createSchema), c.create);
r.post("/:id/submit", allow(...C.work), validate(submitSchema), c.submit);
// What the hospital is owed changes at these three steps, so they are limited to the people who decide.
r.post("/:id/approve", allow(...C.decide), validate(approveSchema), c.approve);
r.post("/:id/reject", allow(...C.decide), validate(rejectSchema), c.reject);
r.post("/:id/payments", allow(...C.decide), validate(paySchema), c.pay);

export default r;