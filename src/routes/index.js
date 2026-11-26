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

// ---- Already working: unchanged ----
api.use("/auth", auth);
api.use("/users", staff); // "staff" in the code, /users in the URL the web app already uses
api.use("/roles", roles);
api.use("/patients", patients);
api.use("/appointments", appointments);
api.use("/emergency-access", emergency);
api.use("/audit", audit);
api.use("/doctors", doctors);
api.use("/doctor", doctors); // the web app calls the singular form too
api.use("/roster", roster);
api.use("/admissions", admissions);
api.use("/billing", billing);
api.use("/claims", claims);
api.use("/admin", admin);

// ---- Modules that existed as files but were never mounted ----
// Each one is loaded on its own. If a file has a problem (a missing controller export, a missing validator), the server
// still starts, the other modules keep working, and the Railway log says exactly which module failed and why.
const OPTIONAL = [
  ["/price-list", "./pricelist.routes.js"],
  ["/laboratory", "./laboratory.routes.js"],
  ["/pharmacy", "./pharmacy.routes.js"],
  ["/nursing", "./nursing.routes.js"],
  ["/duty-roster", "./dutyroster.routes.js"],
  ["/dashboard", "./dashboard.routes.js"],
  ["/reports", "./report.routes.js"],
  ["/settings", "./settings.routes.js"],
  // The money ledger (transactions, money accounts, payroll). Mounted before the profile router below: a path it does not
  // define falls through to that one.
  ["/accounts", "./accounts.routes.js"],
];

for (const [path, file] of OPTIONAL) {
  try {
    const mod = await import(file);
    api.use(path, mod.default);
    console.log(`Routes loaded: /api${path}`);
  } catch (e) {
    console.error(`ROUTES NOT LOADED: /api${path} (${file}): ${e.message}`);
  }
}

// The signed-in person's own profile (kept at its old address, and at /account).
api.use("/accounts", accounts);
api.use("/account", accounts);

export default api;