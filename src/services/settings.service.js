import { query } from "../config/database.js";

export const DEFAULTS = {
  hospital: { name: "", address: "", phone: "", email: "" },
  notify: { appointments: true, lowStock: true, labResults: false, overdueInvoices: true },
  lowStockThreshold: 20,
  invoiceDueDays: 14,
  vatPercent: 0,
  invoiceFooter: "",
  sessionTimeoutMins: 30,
  minPasswordLength: 10,
};

const KEY = "app";

function merge(base, patch) {
  if (!patch || typeof patch !== "object") return { ...base };
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === "object" && !Array.isArray(v) && typeof base[k] === "object" && base[k] && !Array.isArray(base[k])) {
      out[k] = { ...base[k], ...v };
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

export async function getSettings() {
  const [row] = await query("SELECT setting_value FROM hospital_settings WHERE setting_key = ?", [KEY]);
  if (!row) return { ...DEFAULTS, hospital: { ...DEFAULTS.hospital }, notify: { ...DEFAULTS.notify } };
  const stored = typeof row.setting_value === "string" ? JSON.parse(row.setting_value) : row.setting_value;
  return merge(DEFAULTS, stored);
}

export async function putSettings(patch, userId) {
  const current = await getSettings();
  const next = merge(current, patch);
  // clamp a few numbers
  next.lowStockThreshold = Math.max(0, Number(next.lowStockThreshold) || 0);
  next.invoiceDueDays = Math.max(0, Math.min(365, Number(next.invoiceDueDays) || 0));
  next.vatPercent = Math.max(0, Math.min(100, Number(next.vatPercent) || 0));
  next.sessionTimeoutMins = Math.max(5, Math.min(480, Number(next.sessionTimeoutMins) || 30));
  next.minPasswordLength = Math.max(8, Math.min(128, Number(next.minPasswordLength) || 10));

  // Ensure table exists (first deploy may have skipped settings.sql).
  await query(`CREATE TABLE IF NOT EXISTS hospital_settings (
    setting_key   VARCHAR(80)  NOT NULL PRIMARY KEY,
    setting_value JSON         NOT NULL,
    updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    updated_by    VARCHAR(40)  NULL
  ) ENGINE=InnoDB`);

  // Pass JSON text; MariaDB/MySQL JSON columns accept a string without CAST(? AS JSON).
  await query(
    `INSERT INTO hospital_settings (setting_key, setting_value, updated_by)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
    [KEY, JSON.stringify(next), userId || null]
  );
  return getSettings();
}
