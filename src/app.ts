import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import routes from "./routes/index.js";
import { errorMiddleware, notFoundMiddleware } from "./middleware/error.middleware.js";
import { handleStripeWebhook } from "./controllers/payment_controller.js";

const app = express();

app.use(cors({ origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(",") }));

// Stripe's signature check needs the exact raw request body, so this has
// to be registered with express.raw() BEFORE the global express.json()
// below — that's also why it lives here instead of in routes/index.ts,
// which only gets mounted after JSON parsing has already run.
app.post("/api/webhooks/stripe", express.raw({ type: "application/json" }), handleStripeWebhook);

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