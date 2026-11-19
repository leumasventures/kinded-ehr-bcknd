import { Router } from "express";
import auth from "./auth.routes.js";
import staff from "./staff.routes.js";
import roles from "./role.routes.js";
import patients from "./patient.routes.js";
import appointments from "./appointment.routes.js";
import emergency from "./emergency.routes.js";
import audit from "./audit.routes.js";

const api = Router();
api.use("/auth", auth);
api.use("/users", staff); // "staff" in the code, /users in the URL the web app already uses
api.use("/roles", roles);
api.use("/patients", patients);
api.use("/appointments", appointments);
api.use("/emergency-access", emergency);
api.use("/audit", audit);

export default api;
