import { Router } from "express";
import auth from "./auth.routes.js";
import staff from "./staff.routes.js";
import roles from "./role.routes.js";
import patients from "./patient.routes.js";
import appointments from "./appointment.routes.js";
import emergency from "./emergency.routes.js";
import audit from "./audit.routes.js";
import doctors from "./doctor.routes.js";
import roster from "./roster.routes.js";
import admissions from "./admission.routes.js";
import accounts from "./account.routes.js";
import billing from "./billing.routes.js";
import claims from "./claims.routes.js";
import admin from "./admin.routes.js";

const api = Router();
api.use("/auth", auth);
api.use("/users", staff); // "staff" in the code, /users in the URL the web app already uses
api.use("/roles", roles);
api.use("/patients", patients);
api.use("/appointments", appointments);
api.use("/emergency-access", emergency);
api.use("/audit", audit);
api.use("/doctors", doctors);
api.use("/roster", roster);
api.use("/admissions", admissions);
api.use("/accounts", accounts);
api.use("/billing", billing);
api.use("/claims", claims);
api.use("/admin", admin);

export default api;
