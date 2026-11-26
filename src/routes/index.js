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

// Loads a route file on its own: if it has a problem the server still starts and the log says which module failed.
async function mountOptional(path, file) {
  try {
    const mod = await import(file);
    api.use(path, mod.default);
    console.log(`Routes loaded: /api${path}`);
  } catch (e) {
    console.error(`ROUTES NOT LOADED: /api${path} (${file}): ${e.message}`);
  }
}

// ---- Already working: unchanged ----
api.use("/auth", auth);
api.use("/users", staff); // "staff" in the code, /users in the URL the web app already uses
api.use("/roles", roles);
await mountOptional("/patients/stats", "./patientstats.routes.js"); // must come before /patients
api.use("/patients", patients);
api.use("/appointments", appointments);
api.use("/emergency-access", emergency);
api.use("/audit", audit);
api.use("/doctors", doctors);
api.use("/doctor", doctors); // the web app calls the singular form too
api.use("/roster", roster);
api.use("/duty-roster", roster); // the web app calls this address
api.use("/admissions", admissions);
api.use("/billing", billing);
api.use("/claims", claims);
api.use("/admin", admin);

// ---- Modules that existed as files but were never mounted ----
await mountOptional("/price-list", "./pricelist.routes.js");
await mountOptional("/laboratory", "./laboratory.routes.js");
await mountOptional("/pharmacy", "./pharmacy.routes.js");
await mountOptional("/nursing", "./nursing.routes.js");
await mountOptional("/dashboard", "./dashboard.routes.js");
await mountOptional("/reports", "./report.routes.js");
await mountOptional("/settings", "./settings.routes.js");
// The money ledger. Mounted before the profile router below: a path it does not define falls through to that one.
await mountOptional("/accounts", "./accounts.routes.js");

// The signed-in person's own profile (kept at its old address, and at /account).
api.use("/accounts", accounts);
api.use("/account", accounts);

export default api;
