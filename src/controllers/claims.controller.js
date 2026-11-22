import { notFound, wrap } from "../utils/errors.js";
import { audit } from "../services/audit.service.js";
import { approveClaim, claimableByPayer, createClaim, getClaim, listClaims, recordClaimPayment, rejectClaim, submitClaim } from "../services/billing.service.js";

const money = (n) => Number(n).toFixed(2);
const count = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;
// The service does the locking, the money maths and the claim history. This file checks input, calls it, and writes the
// audit entry once it has succeeded. A payer's rejection reason can describe the patient's condition, so audit lines say a
// reason was recorded on the claim but never repeat it; the claim's own history keeps the words.
// The id always comes from the URL: a body can't point these actions at a different claim.

export const list = wrap(async (req, res) => {
  const { status, payer } = req.query;
  res.json({ claims: await listClaims({ status: status ? String(status) : undefined, payer: payer ? String(payer) : undefined }) });
});

// Unpaid invoices of insured patients that aren't in a live claim, grouped by payer: what the "new claim" screen lists.
export const claimable = wrap(async (_req, res) => res.json({ payers: await claimableByPayer() }));

export const get = wrap(async (req, res) => {
  const claim = await getClaim(req.params.id);
  if (!claim) throw notFound("Claim not found.");
  res.json({ claim });
});

export const create = wrap(async (req, res) => {
  const claim = await createClaim(req.body, req.user);
  await audit(req, { action: "Create", module: "Claims", summary: `Created claim ${claim.number} for ${claim.payer} with ${count(claim.lines.length, "invoice")}, total ${money(claim.total)}` });
  res.status(201).json({ claim });
});

export const submit = wrap(async (req, res) => {
  const claim = await submitClaim({ ...req.body, id: req.params.id }, req.user);
  await audit(req, { action: "Update", module: "Claims", summary: `Submitted claim ${claim.number} to ${claim.payer}${claim.reference ? ` (their reference ${claim.reference})` : ""}` });
  res.json({ claim });
});

export const approve = wrap(async (req, res) => {
  const claim = await approveClaim({ ...req.body, id: req.params.id }, req.user);
  await audit(req, { action: "Update", module: "Claims", summary: `Approved claim ${claim.number} by ${claim.payer} for ${money(claim.approvedAmount)} of ${money(claim.total)}` });
  res.json({ claim });
});

// Rejecting frees the claim's invoices, so they can go into a new claim or be paid another way.
export const reject = wrap(async (req, res) => {
  const claim = await rejectClaim({ ...req.body, id: req.params.id }, req.user);
  await audit(req, { action: "Update", module: "Claims", summary: `Rejected claim ${claim.number} by ${claim.payer} (reason recorded on the claim)` });
  res.json({ claim });
});

// Money received from the payer. The service shares it out over the claim's invoices, oldest first, and posts it as
// "HMO / Insurance" payments in the same transaction as the claim's own totals. `posted` shows where each part went.
export const pay = wrap(async (req, res) => {
  const { claim, posted } = await recordClaimPayment({ ...req.body, id: req.params.id }, req.user);
  await audit(req, { action: "Update", module: "Claims", summary: `Recorded payment of ${money(req.body.amount)} from ${claim.payer} on claim ${claim.number}, posted to ${count(posted.length, "invoice")}${claim.status === "Paid" ? "; claim paid in full" : ""}` });
  res.status(201).json({ claim, posted });
});

// There is no edit or delete. A claim moves forward through Draft, Submitted, Approved and Paid, or is Rejected, and every
// step is kept in its history. To start again after a rejection, create a new claim from the same invoices.