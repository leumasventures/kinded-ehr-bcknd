-- Append to sql/schema.sql (or read it from applySchema).
-- If price_list ALREADY EXISTS in your database (you ran the earlier version), this CREATE is skipped and the table has no
-- "unit" column. Run the ALTER at the bottom once, by hand, in phpMyAdmin.
CREATE TABLE IF NOT EXISTS price_list (
  id CHAR(36) PRIMARY KEY,
  code VARCHAR(30) NOT NULL,
  name VARCHAR(160) NOT NULL,
  category VARCHAR(60) NOT NULL,
  unit VARCHAR(40) NOT NULL DEFAULT 'each',
  price DECIMAL(12,2) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_price_code (code),
  INDEX idx_price_cat (category, active)
);

-- ONLY for a database that already has the old price_list table (run once, then never again):
-- ALTER TABLE price_list ADD COLUMN unit VARCHAR(40) NOT NULL DEFAULT 'each' AFTER category;