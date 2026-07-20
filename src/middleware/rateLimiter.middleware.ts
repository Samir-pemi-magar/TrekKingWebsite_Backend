import rateLimit from "express-rate-limit";

// Login/register — protect against credential stuffing / brute force.
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: "error", message: "Too many attempts — please try again in a bit." },
});

// Public contact form — protect against spam floods.
export const inquiryRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: "error", message: "Too many inquiries submitted — please try again later." },
});

// Public booking creation — same reasoning as inquiries.
export const bookingRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: "error", message: "Too many booking attempts — please try again later." },
});
