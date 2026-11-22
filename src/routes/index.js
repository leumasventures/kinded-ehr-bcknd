import { Router } from "express";
import auth from "./auth.routes.js";
import staff from "./staff.routes.js";
import roles from "./role.routes.js";
import patients from "./patient.routes.js";
import appointments from "./appointment.routes.js";
import emergency from "./emergency.routes.js";
import audit from "./audit.routes.js";
import account from "./account.routes.js";
import admin from "./admin.routes.js";
import admissions from "./admission.routes.js";
import billing from "./billing.routes.js";
import claims from "./claims.routes.js";
import dashboard from "./dashboard.routes.js";
import doctor from "./doctor.routes.js";
import dutyroster from "./dutyroster.routes.js";
import laboratory from "./laboratory.routes.js";
import nursing from "./nursing.routes.js";
import pharmacy from "./pharmacy.routes.js";
import pricelist from "./pricelist.routes.js";
import report from "./report.routes.js";

const api = Router();
api.use("/auth", auth);
api.use("/users", staff); // "staff" in the code, /users in the URL the web app already uses
api.use("/roles", roles);
api.use("/patients", patients);
api.use("/appointments", appointments);
api.use("/emergency-access", emergency);
api.use("/audit", audit);

api.use("/account", account);
api.use("/admin", admin);
api.use("/admissions", admissions);
api.use("/billing", billing);
api.use("/claims", claims);
api.use("/dashboard", dashboard);
api.use("/doctor", doctor);
api.use("/duty-roster", dutyroster);
api.use("/laboratory", laboratory);
api.use("/nursing", nursing);
api.use("/pharmacy", pharmacy);
api.use("/price-list", pricelist);
api.use("/reports", report);

export default api;