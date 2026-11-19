import { assertConfig, config } from "./config/environment.js";
import { createApp } from "./app.js";
import { pool } from "./config/database.js";

assertConfig();

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`Kinded Care EHR server listening on port ${config.port}`);
});

const stop = async () => {
  console.log("Shutting down Kinded Care EHR...");

  server.close(async () => {
    try {
      await pool.end();
      console.log("Database connections closed.");
      process.exit(0);
    } catch (error) {
      console.error("Shutdown error:", error);
      process.exit(1);
    }
  });
};

process.on("SIGTERM", stop);
process.on("SIGINT", stop);