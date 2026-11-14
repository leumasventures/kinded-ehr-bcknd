// Mirrors src/types/access.ts in the web app. The server is the one that enforces it.
export const MODULES = ["Patients", "Appointments", "Doctors", "Laboratory", "Pharmacy", "Nursing", "Admissions", "Billing", "Accounts", "Roster", "Reports", "Settings"];
export const ACTIONS = ["view", "create", "edit", "delete"];

export const emptyPermissions = () => Object.fromEntries(MODULES.map((m) => [m, { view: false, create: false, edit: false, delete: false }]));

/** Keeps only known modules and actions and forces real booleans, so stored or submitted data can't smuggle anything in. */
export function normalizePermissions(p) {
  const base = emptyPermissions();
  if (!p || typeof p !== "object") return base;
  for (const m of MODULES) for (const a of ACTIONS) base[m][a] = p[m]?.[a] === true;
  return base;
}

const grant = (modules, actions) => {
  const p = emptyPermissions();
  for (const m of modules) for (const a of actions) p[m][a] = true;
  return p;
};

export const ADMIN_ROLE_ID = "r-admin";

export const seedRoles = [
  { id: ADMIN_ROLE_ID, name: "Administrator", description: "Full access to every module", permissions: grant(MODULES, ACTIONS) },
  { id: "r-doctor", name: "Doctor", description: "Clinical access to patients, appointments, lab and admissions", permissions: grant(["Patients", "Appointments", "Doctors", "Laboratory", "Admissions"], ["view", "create", "edit"]) },
  { id: "r-nurse", name: "Nurse", description: "Ward care, vitals and patient records", permissions: grant(["Patients", "Nursing", "Admissions"], ["view", "create", "edit"]) },
  { id: "r-pharmacist", name: "Pharmacist", description: "Manages drug inventory and dispensing", permissions: grant(["Pharmacy"], ACTIONS) },
  {
    id: "r-accountant",
    name: "Accountant",
    description: "Manages accounts, expenses, payroll and financial records",
    permissions: (() => {
      const p = grant(["Accounts"], ["view", "create", "edit"]);
      p.Billing.view = true;
      p.Reports.view = true;
      return p;
    })(),
  },
  { id: "r-cashier", name: "Cashier", description: "Invoices and payments", permissions: grant(["Billing"], ["view", "create", "edit"]) },
];

/** A user's own privileges, when set, replace the role's. */
export const effectivePermissions = (userPermissions, rolePermissions) => normalizePermissions(userPermissions ?? rolePermissions);
