import mysql from "mysql2/promise";
import { assertDatabaseConfig, config } from "../src/config/environment.js";
import { applySchema } from "./applySchema.js";

// Creates or upgrades the tables in the hosted database. Safe to run again.
assertDatabaseConfig();
const conn = await mysql.createConnection({ host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password, database: config.db.database, ssl: config.db.ssl ? { rejectUnauthorized: true } : undefined, multipleStatements: true });
try {
  const { version, warnings } = await applySchema(conn);
  console.log(`Database is up to date (server ${version}).`);
  for (const w of warnings) console.warn(`WARNING: ${w}`);
} finally {
  await conn.end();
}
