-- Append to sql/schema.sql (or read it from applySchema). Dispensing uses addCharges from billing.service.js.
-- Seeds an 'rx' counter so the first prescription is RX-1001.
CREATE TABLE IF NOT EXISTS drugs (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  strength VARCHAR(40) NOT NULL DEFAULT '',
  form VARCHAR(40) NOT NULL DEFAULT '',
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  stock_qty INT NOT NULL DEFAULT 0,
  reorder_level INT NOT NULL DEFAULT 10,
  active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_drug (name, strength, form),
  INDEX idx_drug_stock (active, stock_qty)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id CHAR(36) PRIMARY KEY,
  drug_id CHAR(36) NOT NULL,
  delta INT NOT NULL,
  balance INT NOT NULL,
  reason VARCHAR(255) NOT NULL,
  ref VARCHAR(40) NULL,
  by_id VARCHAR(40) NULL,
  at DATETIME NOT NULL,
  INDEX idx_move_drug (drug_id, at)
);

CREATE TABLE IF NOT EXISTS prescriptions (
  id VARCHAR(20) PRIMARY KEY,
  patient_id VARCHAR(20) NOT NULL,
  prescriber_id VARCHAR(40) NOT NULL,
  drug_id CHAR(36) NOT NULL,
  dose VARCHAR(80) NOT NULL,
  frequency VARCHAR(80) NOT NULL,
  duration VARCHAR(80) NULL,
  quantity INT NOT NULL,
  instructions VARCHAR(255) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Pending',
  created_at DATETIME NOT NULL,
  dispensed_by VARCHAR(40) NULL,
  dispensed_at DATETIME NULL,
  cancelled_at DATETIME NULL,
  cancel_reason VARCHAR(255) NULL,
  INDEX idx_rx_patient (patient_id),
  INDEX idx_rx_status (status, created_at),
  INDEX idx_rx_prescriber (prescriber_id, status)
);

INSERT IGNORE INTO counters (name, value) VALUES ('rx', 1000);