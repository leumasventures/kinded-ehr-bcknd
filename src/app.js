import express from "express";
import helmet from "helmet";
import cors from "cors";
import { config } from "./config/environment.js";
import { pool } from "./config/database.js";
import api from "./routes/index.js";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware.js";

export function createApp() {
  const app = express();
  app.use("/api", api);
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin(origin, cb) {
        // No Origin header = not a browser (curl, tests, health checks). Browsers must come from a listed site.
        if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
        cb(null, false);
      },
      allowedHeaders: ["Authorization", "Content-Type"],
      methods: ["GET", "POST", "PUT", "DELETE"],
      maxAge: 600,
    })
  );
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  app.use("/api", api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
