import { wrap } from "../utils/errors.js";
import { audit } from "../services/audit.service.js";
import { getSettings, putSettings } from "../services/settings.service.js";

export const get = wrap(async (_req, res) => {
  res.json({ settings: await getSettings() });
});

export const update = wrap(async (req, res) => {
  const settings = await putSettings(req.body, req.user.id);
  await audit(req, {
    action: "Update",
    module: "Settings",
    summary: `${req.user.name} updated hospital settings`,
  });
  res.json({ settings });
});
