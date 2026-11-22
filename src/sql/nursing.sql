-- Append to sql/schema.sql (or read it from applySchema). Uses the admissions table to tie readings to a stay.
CREATE TABLE IF NOT EXISTS nursing_vitals (
  id CHAR(36) PRIMARY KEY,
  patient_id VARCHAR(20) NOT NULL,
  admission_id CHAR(36) NULL,
  recorded_by VARCHAR(40) NOT NULL,
  recorded_at DATETIME NOT NULL,
  temp_c DECIMAL(4,1) NULL,
  pulse INT NULL,
  resp_rate INT NULL,
  bp_sys INT NULL,
  bp_dia INT NULL,
  spo2 INT NULL,
  weight_kg DECIMAL(5,1) NULL,
  notes VARCHAR(255) NULL,
  INDEX idx_vitals_patient (patient_id, recorded_at)
);

CREATE TABLE IF NOT EXISTS nursing_notes (
  id CHAR(36) PRIMARY KEY,
  patient_id VARCHAR(20) NOT NULL,
  admission_id CHAR(36) NULL,
  author_id VARCHAR(40) NOT NULL,
  note TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_nnotes_patient (patient_id, created_at)
);