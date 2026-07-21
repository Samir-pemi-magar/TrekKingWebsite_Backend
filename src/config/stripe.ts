import Stripe from "stripe";
import { env, stripeEnabled } from "./env.js";

// null when STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET aren't set — callers
// (payment.controller.ts) check for that and respond with a clear "not
// configured yet" error instead of crashing the process at boot.
export const stripe = stripeEnabled
  ? new Stripe(env.STRIPE_SECRET_KEY!, { apiVersion: "2026-06-24.dahlia" })
  : null;