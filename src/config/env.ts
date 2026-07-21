import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.string().default("5000"),
  CORS_ORIGIN: z.string().default("*"),
  FRONTEND_URL: z.string().default("http://localhost:3000"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  JWT_SECRET: z.string().min(10, "JWT_SECRET must be at least 10 characters"),
  JWT_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_SECRET: z.string().min(10, "JWT_REFRESH_SECRET must be at least 10 characters"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("30d"),

  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  CLOUDINARY_CLOUD_NAME: z.string().min(1, "CLOUDINARY_CLOUD_NAME is required"),
  CLOUDINARY_API_KEY: z.string().min(1, "CLOUDINARY_API_KEY is required"),
  CLOUDINARY_API_SECRET: z.string().min(1, "CLOUDINARY_API_SECRET is required"),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_SECURE: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default("Bhraman Treks <no-reply@bhraman.com>"),
  ADMIN_NOTIFICATION_EMAIL: z.string().optional(),

  // Optional like SMTP — a first deploy shouldn't crash just because the
  // client hasn't handed over live Stripe keys yet.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // Same optional pattern — eSewa checkout stays disabled (with a startup
  // warning) until the client's merchant code + secret key are set.
  ESEWA_MERCHANT_CODE: z.string().optional(),
  ESEWA_SECRET_KEY: z.string().optional(),

  // Same pattern again — Khalti's KPG-2 API needs just one secret key
  // (the `live_secret_key` shown in either test-admin.khalti.com for
  // sandbox, or admin.khalti.com for production).
  KHALTI_SECRET_KEY: z.string().optional(),

  // Same optional pattern — Fonepay checkout stays disabled until the
  // client has a real merchant code + secret key (issued through their
  // bank; unlike eSewa there's no public shared sandbox credential).
  FONEPAY_MERCHANT_CODE: z.string().optional(),
  FONEPAY_SECRET_KEY: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

// Email is optional infrastructure — don't crash the whole server if it's
// unset, just warn so a first deploy can happen before SMTP is wired up.
export const emailEnabled = Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD);
if (!emailEnabled && env.NODE_ENV !== "test") {
  console.warn("⚠️  SMTP not configured — booking/inquiry email notifications are disabled.");
}

// Same pattern — card checkout/webhook handlers check this and no-op
// gracefully instead of crashing when the client's Stripe keys aren't in
// the environment yet.
export const stripeEnabled = Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
if (!stripeEnabled && env.NODE_ENV !== "test") {
  console.warn("⚠️  Stripe not configured — card checkout is disabled.");
}

// Same pattern again — eSewa checkout/verification handlers check this and
// no-op gracefully (ApiError.badRequest) instead of crashing when the
// client's eSewa merchant credentials aren't in the environment yet.
export const esewaEnabled = Boolean(env.ESEWA_MERCHANT_CODE && env.ESEWA_SECRET_KEY);
if (!esewaEnabled && env.NODE_ENV !== "test") {
  console.warn("⚠️  eSewa not configured — eSewa checkout is disabled.");
}

// Same pattern again — Khalti checkout/verification handlers check this
// and no-op gracefully instead of crashing when the client's Khalti secret
// key isn't in the environment yet.
export const khaltiEnabled = Boolean(env.KHALTI_SECRET_KEY);
if (!khaltiEnabled && env.NODE_ENV !== "test") {
  console.warn("⚠️  Khalti not configured — Khalti checkout is disabled.");
}

// Same pattern again — Fonepay checkout/verification handlers check this
// and no-op gracefully instead of crashing when the client's Fonepay
// merchant credentials aren't in the environment yet.
export const fonepayEnabled = Boolean(env.FONEPAY_MERCHANT_CODE && env.FONEPAY_SECRET_KEY);
if (!fonepayEnabled && env.NODE_ENV !== "test") {
  console.warn("⚠️  Fonepay not configured — Fonepay checkout is disabled.");
}