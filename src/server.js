import { assertConfig, config } from "./config/environment.js";
import { createApp } from "./app.js";
import { pool } from "./config/database.js";

assertConfig();
const server = createApp().listen(config.port, () => console.log(`Hospital server listening on port ${config.port}`));

const stop = async () => {
  server.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
