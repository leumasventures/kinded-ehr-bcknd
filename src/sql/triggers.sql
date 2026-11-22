-- Append-only guards. They are applied separately from schema.sql because some shared hosts refuse to let an ordinary
-- database user create triggers (MySQL error 1419 or 1227). If that happens, scripts/migrate.js says so and carries on:
-- the audit log is still hash-chained, so a changed or removed row is still caught by "verify", but the database itself
-- no longer refuses the edit. Ask the host to enable triggers (or log_bin_trust_function_creators) to get full protection.

DROP TRIGGER IF EXISTS audit_log_no_update;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only';
DROP TRIGGER IF EXISTS audit_log_no_delete;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only';

DROP TRIGGER IF EXISTS patient_merges_no_update;
CREATE TRIGGER patient_merges_no_update BEFORE UPDATE ON patient_merges FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'patient_merges is append-only';
DROP TRIGGER IF EXISTS patient_merges_no_delete;
CREATE TRIGGER patient_merges_no_delete BEFORE DELETE ON patient_merges FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'patient_merges is append-only';
