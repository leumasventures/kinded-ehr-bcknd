import { Router } from "express";
import { authenticate, requirePerm, requireAny, validate } from "./guards.js";
import * as c from "../controllers/pharmacy.controller.js";
import { cancelSchema, drugSchema, drugUpdateSchema, prescribeSchema, stockSchema } from "../validators/pharmacy.validator.js";

const r = Router();
r.use(authenticate());

// Drugs and stock: the Pharmacy module. Doctors also need to look drugs up when prescribing.
r.get("/drugs", requireAny(["Pharmacy", "view"], ["Doctors", "view"]), c.drugs);
r.post("/drugs", requirePerm("Pharmacy", "create"), validate(drugSchema), c.addDrug);
r.put("/drugs/:id", requirePerm("Pharmacy", "edit"), validate(drugUpdateSchema), c.editDrug);
r.patch("/drugs/:id", requirePerm("Pharmacy", "edit"), validate(drugUpdateSchema), c.editDrug);
r.post("/drugs/:id/stock", requirePerm("Pharmacy", "edit"), validate(stockSchema), c.stock);
r.get("/drugs/:id/movements", requirePerm("Pharmacy", "view"), c.movements);

// Prescriptions: doctors write them (the Doctors module), the pharmacy fills them (the Pharmacy module).
r.get("/prescriptions", requireAny(["Pharmacy", "view"], ["Doctors", "view"]), c.list);
r.get("/prescriptions/:id", requireAny(["Pharmacy", "view"], ["Doctors", "view"]), c.get);
r.post("/prescriptions", requirePerm("Doctors", "create"), validate(prescribeSchema), c.create);
r.post("/prescriptions/:id/dispense", requirePerm("Pharmacy", "edit"), c.dispenseOne);
r.post("/prescriptions/:id/cancel", requireAny(["Pharmacy", "edit"], ["Doctors", "edit"]), validate(cancelSchema), c.cancel);

export default r;