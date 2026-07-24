import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.string().default("5000"),
  CORS_ORIGIN: z.string().default("*"),
  FRONTEND_URL: z.string().default("http://localhost:3000"),
  // Public base URL of THIS API server — needed to build the Google OAuth
  // callback URL, which must be an absolute URL Google redirects back to.
  BACKEND_URL: z.string().default("http://localhost:5000"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  JWT_SECRET: z.string().min(10, "JWT_SECRET must be at least 10 characters"),
  JWT_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_SECRET: z.string().min(10, "JWT_REFRESH_SECRET must be at least 10 characters"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("30d"),

  // Used only to sign the short-lived OAuth handshake cookie (CSRF `state`
  // param) that passport needs during the Google redirect round-trip. Not
  // used for normal app sessions — those stay JWT/stateless as before.
  SESSION_SECRET: z.string().min(10, "SESSION_SECRET must be at least 10 characters"),

  // Optional like SMTP/Stripe below — "Continue with Google" stays hidden/
  // disabled until the client's real OAuth client ID + secret are set.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

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

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  ESEWA_MERCHANT_CODE: z.string().optional(),
  ESEWA_SECRET_KEY: z.string().optional(),

  KHALTI_SECRET_KEY: z.string().optional(),

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

// The full, absolute callback URL Google redirects back to after consent.
// Derived from BACKEND_URL rather than a separate env var so there's one
// less thing to keep in sync across environments.
export const googleCallbackUrl = `${env.BACKEND_URL.replace(/\/$/, "")}/api/auth/google/callback`;

export const emailEnabled = Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD);
if (!emailEnabled && env.NODE_ENV !== "test") {
  console.warn("⚠️  SMTP not configured — booking/inquiry email notifications (and account verification emails) are disabled.");
}

export const stripeEnabled = Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
if (!stripeEnabled && env.NODE_ENV !== "test") {
  console.warn("⚠️  Stripe not configured — card checkout is disabled.");
}

export const esewaEnabled = Boolean(env.ESEWA_MERCHANT_CODE && env.ESEWA_SECRET_KEY);
if (!esewaEnabled && env.NODE_ENV !== "test") {
  console.warn("⚠️  eSewa not configured — eSewa checkout is disabled.");
}

export const khaltiEnabled = Boolean(env.KHALTI_SECRET_KEY);
if (!khaltiEnabled && env.NODE_ENV !== "test") {
  console.warn("⚠️  Khalti not configured — Khalti checkout is disabled.");
}

export const fonepayEnabled = Boolean(env.FONEPAY_MERCHANT_CODE && env.FONEPAY_SECRET_KEY);
if (!fonepayEnabled && env.NODE_ENV !== "test") {
  console.warn("⚠️  Fonepay not configured — Fonepay checkout is disabled.");
}

// Same optional pattern as Stripe/eSewa/etc — the /auth/google routes check
// this and 404/no-op instead of crashing when Google OAuth creds aren't set.
export const googleAuthEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
if (!googleAuthEnabled && env.NODE_ENV !== "test") {
  console.warn("⚠️  Google OAuth not configured — 'Continue with Google' is disabled.");
}