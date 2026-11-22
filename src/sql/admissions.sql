-- Append to sql/schema.sql (or read it from applySchema). Needs MySQL 8+ or MariaDB 10.2.5+ for stored generated columns.
-- The two UNIQUE keys on the generated columns allow one open admission per patient and one patient per bed.
-- They are NULL once status is no longer 'Admitted', so discharged rows never block anyone.
CREATE TABLE IF NOT EXISTS admissions (
  id CHAR(36) PRIMARY KEY,
  patient_id VARCHAR(20) NOT NULL,
  doctor_id VARCHAR(40) NULL,
  ward VARCHAR(60) NULL,
  bed VARCHAR(30) NULL,
  reason TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Admitted',
  admitted_at DATETIME NOT NULL,
  discharged_at DATETIME NULL,
  outcome VARCHAR(30) NULL,
  discharge_summary TEXT NULL,
  created_by VARCHAR(40) NULL,
  active_patient VARCHAR(20) GENERATED ALWAYS AS (IF(status = 'Admitted', patient_id, NULL)) STORED,
  active_bed VARCHAR(100) GENERATED ALWAYS AS (IF(status = 'Admitted' AND ward IS NOT NULL AND bed IS NOT NULL, CONCAT(ward, '|', bed), NULL)) STORED,
  UNIQUE KEY uq_adm_patient (active_patient),
  UNIQUE KEY uq_adm_bed (active_bed),
  INDEX idx_adm_patient (patient_id, status),
  INDEX idx_adm_ward (status, ward),
  INDEX idx_adm_doctor (doctor_id, status)
);