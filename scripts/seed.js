import { randomUUID } from "node:crypto";
import { query, pool } from "../src/config/database.js";
import { hashPassword, temporaryPassword } from "../src/services/password.service.js";
import { seedRoles } from "../src/config/permissions.js";

// Creates the standard roles, and the first administrator if nobody exists yet.
//   ADMIN_EMAIL=you@example.com ADMIN_NAME="Your Name" npm run seed
for (const r of seedRoles) {
  await query(
    "INSERT INTO roles (id, name, description, permissions, is_system) VALUES (?,?,?,?,1) ON DUPLICATE KEY UPDATE description = VALUES(description)",
    [r.id, r.name, r.description, JSON.stringify(r.permissions)]
  );
}
// The Administrator role always has everything; the other standard roles are left alone once an admin has edited them.
await query("UPDATE roles SET permissions = ? WHERE id = 'r-admin'", [JSON.stringify(seedRoles[0].permissions)]);

const [{ n }] = await query("SELECT COUNT(*) AS n FROM users");
if (Number(n) === 0) {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (!email.includes("@")) {
    console.error("No users exist yet. Run again with ADMIN_EMAIL set, for example:\n  ADMIN_EMAIL=you@example.com ADMIN_NAME=\"Your Name\" npm run seed");
    await pool.end();
    process.exit(1);
  }
  const temp = temporaryPassword();
  await query("INSERT INTO users (id, name, email, role_id, active, must_change_password, password_hash) VALUES (?,?,?,?,1,1,?)", [`u-${randomUUID().slice(0, 8)}`, process.env.ADMIN_NAME?.trim() || "Administrator", email, "r-admin", await hashPassword(temp)]);
  console.log(`\nFirst administrator created.\n  Email:              ${email}\n  Temporary password: ${temp}\n\nSign in, then choose a new password. This password is not stored anywhere and will not be shown again.\n`);
} else {
  console.log("Roles are up to date. Users already exist, so no administrator was created.");
}
await pool.end();
