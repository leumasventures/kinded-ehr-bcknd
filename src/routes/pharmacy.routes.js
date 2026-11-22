import { Router } from "express";
import { authenticate, allow, validate, ACCESS } from "./guards.js";
import * as c from "../controllers/pharmacy.controller.js";
import { cancelSchema, drugSchema, drugUpdateSchema, prescribeSchema, stockSchema } from "../validators/pharmacy.validator.js";

const P = ACCESS.pharmacy;
const r = Router();
r.use(authenticate());

// drugs and stock
r.get("/drugs", allow(...P.read), c.drugs);
r.post("/drugs", allow(...P.manage), validate(drugSchema), c.addDrug);
r.patch("/drugs/:id", allow(...P.manage), validate(drugUpdateSchema), c.editDrug);
r.post("/drugs/:id/stock", allow(...P.manage), validate(stockSchema), c.stock);
r.get("/drugs/:id/movements", allow(...P.manage), c.movements);

// prescriptions
r.get("/prescriptions", allow(...P.read), c.list);
r.get("/prescriptions/:id", allow(...P.read), c.get);
r.post("/prescriptions", allow(...P.prescribe), validate(prescribeSchema), c.create);
r.post("/prescriptions/:id/dispense", allow(...P.dispense), c.dispenseOne);
r.post("/prescriptions/:id/cancel", allow(...P.cancel), validate(cancelSchema), c.cancel);

export default r;