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
