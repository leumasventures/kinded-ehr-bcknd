-- Append to sql/schema.sql (or read it from applySchema).
-- Also add 'lab' to the counters seed in applySchema:  INSERT IGNORE INTO counters (name, value) VALUES (..., ('lab', 500))
-- (the INSERT below does the same thing, so you can use either). The first order is then L-501.
CREATE TABLE IF NOT EXISTS lab_orders (
  id VARCHAR(20) PRIMARY KEY,
  patient_id VARCHAR(20) NOT NULL,
  ordered_by VARCHAR(40) NOT NULL,
  priority VARCHAR(10) NOT NULL DEFAULT 'Routine',
  status VARCHAR(20) NOT NULL DEFAULT 'Ordered',
  clinical_notes VARCHAR(1000) NULL,
  ordered_at DATETIME NOT NULL,
  collected_at DATETIME NULL,
  collected_by VARCHAR(40) NULL,
  resulted_at DATETIME NULL,
  resulted_by VARCHAR(40) NULL,
  reviewed_at DATETIME NULL,
  reviewed_by VARCHAR(40) NULL,
  cancelled_at DATETIME NULL,
  cancel_reason VARCHAR(255) NULL,
  INDEX idx_lab_patient (patient_id),
  INDEX idx_lab_status (status, priority, ordered_at),
  INDEX idx_lab_doctor (ordered_by, status)
);

CREATE TABLE IF NOT EXISTS lab_order_tests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id VARCHAR(20) NOT NULL,
  price_item_id CHAR(36) NULL,
  code VARCHAR(30) NOT NULL,
  name VARCHAR(160) NOT NULL,
  result_value VARCHAR(500) NULL,
  unit VARCHAR(30) NULL,
  reference_range VARCHAR(80) NULL,
  flag VARCHAR(10) NULL,
  INDEX idx_lot_order (order_id)
);

INSERT IGNORE INTO counters (name, value) VALUES ('lab', 500);