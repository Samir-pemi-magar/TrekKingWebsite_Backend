import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import routes from "./routes/index.js";
import { errorMiddleware, notFoundMiddleware } from "./middleware/error.middleware.js";

const app = express();

app.use(cors({ origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(",") }));
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ status: "ok", message: "Bhraman backend is running" });
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api", routes);

// 404 + central error handler — must be registered last, in this order.
app.use(notFoundMiddleware);
app.use(errorMiddleware);

export default app;
