import { notFound, wrap } from "../utils/errors.js";
import { audit } from "../services/audit.service.js";
import { CLAIM_STATUSES, approveClaim, claimableByPayer, createClaim, getClaim, listClaims, recordClaimPayment, rejectClaim, submitClaim } from "../services/billing.service.js";

const money = (n) => Number(n).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const by = (req) => ({ id: req.user.id, name: req.user.name });

export const list = wrap(async (req, res) => {
  const { status, payer } = req.query;
  res.json({ claims: await listClaims({ status: CLAIM_STATUSES.includes(String(status)) ? String(status) : undefined, payer: payer ? String(payer) : undefined }) });
});
export const claimable = wrap(async (_req, res) => res.json({ groups: await claimableByPayer() }));
export const get = wrap(async (req, res) => {
  const claim = await getClaim(req.params.id);
  if (!claim) throw notFound("Claim not found.");
  res.json({ claim });
});
export const create = wrap(async (req, res) => {
  const claim = await createClaim(req.body, by(req));
  await audit(req, { action: "Create", module: "Billing", summary: `Started claim ${claim.id} to ${claim.payer} with ${claim.lines.length} invoice(s), ${money(claim.total)}` });
  res.status(201).json({ claim });
});
export const submit = wrap(async (req, res) => {
  const claim = await submitClaim({ id: req.params.id, ...req.body, reference: req.body.reference || undefined }, by(req));
  await audit(req, { action: "Update", module: "Billing", summary: `Submitted claim ${claim.id} to ${claim.payer}` });
  res.json({ claim });
});
export const approve = wrap(async (req, res) => {
  const claim = await approveClaim({ id: req.params.id, approvedAmount: req.body.approvedAmount }, by(req));
  await audit(req, { action: "Update", module: "Billing", summary: `Claim ${claim.id} approved for ${money(claim.approvedAmount)} of ${money(claim.total)}` });
  res.json({ claim });
});
export const reject = wrap(async (req, res) => {
  const claim = await rejectClaim({ id: req.params.id, reason: req.body.reason }, by(req));
  await audit(req, { action: "Update", module: "Billing", summary: `Claim ${claim.id} rejected by ${claim.payer}: ${req.body.reason}` });
  res.json({ claim });
});
export const pay = wrap(async (req, res) => {
  const { claim, posted } = await recordClaimPayment({ id: req.params.id, amount: req.body.amount, date: req.body.date, reference: req.body.reference || undefined }, by(req));
  await audit(req, { action: "Payment", module: "Billing", summary: `Received ${money(req.body.amount)} from ${claim.payer} on claim ${claim.id} across ${posted.length} invoice(s)` });
  res.status(201).json({ claim, posted });
});
