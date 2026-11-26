-- Hospital-wide settings (single-row key/value). Safe to re-run.
CREATE TABLE IF NOT EXISTS hospital_settings (
  setting_key   VARCHAR(80)  NOT NULL PRIMARY KEY,
  setting_value JSON         NOT NULL,
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  updated_by    VARCHAR(40)  NULL
) ENGINE=InnoDB;
