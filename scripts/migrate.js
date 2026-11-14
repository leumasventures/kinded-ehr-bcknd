import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";
import { config } from "../src/config/environment.js";

// Runs sql/schema.sql. Safe to run again: every statement is idempotent.
const conn = await mysql.createConnection({ host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password, database: config.db.database, ssl: config.db.ssl ? { rejectUnauthorized: true } : undefined, multipleStatements: true });
await conn.query(readFileSync(new URL("../sql/schema.sql", import.meta.url), "utf8"));
await conn.query("INSERT IGNORE INTO counters (name, value) VALUES ('patient', 1000)");
await conn.end();
console.log("Database is up to date.");
