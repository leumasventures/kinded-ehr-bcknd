-- Append to sql/schema.sql (or read it from applySchema).
CREATE TABLE IF NOT EXISTS duty_roster (
  id CHAR(36) PRIMARY KEY,
  staff_id VARCHAR(40) NOT NULL,
  shift_date DATE NOT NULL,
  shift VARCHAR(20) NOT NULL,
  department VARCHAR(60) NULL,
  notes VARCHAR(255) NULL,
  created_by VARCHAR(40) NULL,
  UNIQUE KEY uq_roster (staff_id, shift_date, shift),
  INDEX idx_roster_date (shift_date, shift)
);