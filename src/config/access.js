// Who may do what. This is the ONE place to change when a role id differs, or when a rule should be stricter or looser.
// ASSUMPTION: these role ids are guesses. Replace them with the ids in your roles table.
// The administrator role always passes (see middleware/allow.js), so it is never listed.
const doctor = ["doctor"];
const nurse = ["nurse"];
const lab = ["lab_scientist"];
const pharmacist = ["pharmacist"];
const front = ["receptionist"];
const billing = ["billing", "accountant"];
const billingManager = ["accountant"]; // the people who may approve claims and set prices
const clinical = [...doctor, ...nurse];

export const ACCESS = {
  admissions: { read: [...clinical, ...front, ...billing], admit: [...clinical, ...front], manage: clinical },
  billing: { read: [...billing, ...front], write: billing },
  claims: { work: billing, decide: billingManager },
  dashboard: { money: billing },
  doctor: { use: doctor },
  laboratory: { read: [...lab, ...clinical], order: doctor, collect: [...lab, ...nurse], result: lab, review: doctor, cancel: [...doctor, ...lab] },
  nursing: { use: clinical },
  pharmacy: { read: [...pharmacist, ...clinical], manage: pharmacist, prescribe: doctor, dispense: pharmacist, cancel: [...doctor, ...pharmacist] },
  priceList: { edit: billingManager },
  reports: { money: billing, clinical: clinical, pharmacy: [...pharmacist, ...clinical] },
  // Everything not listed here is open to any signed-in person (account, roster views, price list reads, dashboard overview)
  // or administrators only (admin tools, roster changes).
};