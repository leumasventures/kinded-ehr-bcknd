/** Next number from the shared counters table. Safe under concurrency: the UPDATE locks the row and LAST_INSERT_ID is per connection. */
export async function nextCounter(conn, name, start = 0) {
  await conn.query("INSERT IGNORE INTO counters (name, value) VALUES (?, ?)", [name, start]);
  await conn.query("UPDATE counters SET value = LAST_INSERT_ID(value + 1) WHERE name = ?", [name]);
  const [[r]] = await conn.query("SELECT LAST_INSERT_ID() AS n");
  return Number(r.n);
}

/** Takes a named lock for the rest of the transaction, so two requests for the same ward (or the same ledger) queue up. */
export async function lockName(conn, name) {
  await conn.query("INSERT IGNORE INTO counters (name, value) VALUES (?, 0)", [`lock:${name}`]);
  await conn.query("SELECT value FROM counters WHERE name = ? FOR UPDATE", [`lock:${name}`]);
}

export const todayISO = () => new Date().toISOString().slice(0, 10);
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
