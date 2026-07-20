import nodemailer from "nodemailer";
import { env, emailEnabled } from "./env.js";

const transporter = emailEnabled
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT ?? 587),
      secure: env.SMTP_SECURE === "true",
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    })
  : null;

// Fire-and-forget — a failed email should never break the request that
// triggered it (booking creation, inquiry submission, etc).
export async function sendMail(to: string, subject: string, html: string): Promise<void> {
  if (!transporter) {
    console.log(`[mailer] SMTP disabled — would have sent "${subject}" to ${to}`);
    return;
  }
  try {
    await transporter.sendMail({ from: env.MAIL_FROM, to, subject, html });
  } catch (err) {
    console.error(`[mailer] Failed to send "${subject}" to ${to}:`, err);
  }
}

export const templates = {
  inquiryReceived: (name: string) => `
    <p>Hi ${name},</p>
    <p>Thanks for reaching out — we've received your inquiry and will get back to you shortly.</p>
  `,
  newInquiryAdmin: (name: string, email: string, message: string) => `
    <p>New inquiry from <strong>${name}</strong> (${email}):</p>
    <p>${message}</p>
  `,
  bookingReceived: (name: string, tripName: string, status: string) => `
    <p>Hi ${name},</p>
    <p>Your booking for <strong>${tripName}</strong> has been received and is currently <strong>${status}</strong>.
    We'll email you again once it's confirmed.</p>
  `,
  bookingStatusUpdate: (name: string, tripName: string, status: string) => `
    <p>Hi ${name},</p>
    <p>Your booking for <strong>${tripName}</strong> is now <strong>${status}</strong>.</p>
  `,
  passwordReset: (name: string, resetLink: string) => `
    <p>Hi ${name},</p>
    <p>We received a request to reset your password. Click the link below to choose a new one:</p>
    <p><a href="${resetLink}">Reset your password</a></p>
    <p>This link expires in 30 minutes. If you didn't request this, you can safely ignore this email.</p>
  `,
};