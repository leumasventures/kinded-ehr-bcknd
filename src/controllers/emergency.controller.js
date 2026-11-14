import { config } from "../config/environment.js";
import { conflict, wrap } from "../utils/errors.js";
import { audit } from "../services/audit.service.js";
import { activeGrant, endGrants, grantOut, startGrant } from "../services/emergency.service.js";

export const status = wrap(async (req, res) => {
  const g = await activeGrant(req.user.id);
  res.json({ grant: g ? grantOut(g) : null });
});

// "Break glass": staff with no access to patient records can read them for a limited time. The server sets the clock and the log.
export const start = wrap(async (req, res) => {
  const { reason } = req.body;
  if (req.user.permissions.Patients.view) throw conflict("You already have access to patient records.");
  if (await activeGrant(req.user.id)) throw conflict("Emergency access is already on for you.");
  await startGrant(req.user.id, reason, config.emergencyMinutes);
  await audit(req, { action: "Security", module: "Emergency access", summary: `${req.user.name} (${req.user.roleName}) opened patient records in an emergency, read-only for ${config.emergencyMinutes} minutes`, detail: `Reason given: ${reason}` });
  res.status(201).json({ grant: grantOut(await activeGrant(req.user.id)) });
});

export const end = wrap(async (req, res) => {
  if (await endGrants(req.user.id, "ended by user")) await audit(req, { action: "Security", module: "Emergency access", summary: `Emergency access ended for ${req.user.name}` });
  res.json({ ok: true });
});
