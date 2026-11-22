-- Append to sql/schema.sql (or read it from applySchema).
CREATE TABLE IF NOT EXISTS price_list (
  id CHAR(36) PRIMARY KEY,
  code VARCHAR(30) NOT NULL,
  name VARCHAR(160) NOT NULL,
  category VARCHAR(60) NOT NULL,
  price DECIMAL(12,2) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_price_code (code),
  INDEX idx_price_cat (category, active)
);