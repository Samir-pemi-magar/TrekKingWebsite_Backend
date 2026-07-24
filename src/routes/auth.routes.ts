import { Router } from "express";
import * as AuthController from "../controllers/auth.controller.js";
import { requireAuth, optionalAuth } from "../middleware/auth.middleware.js";
import { authRateLimiter } from "../middleware/rateLimiter.middleware.js";
import passport from "../config/passport.js";
import { env, googleAuthEnabled } from "../config/env.js";

const router = Router();

router.post("/register", authRateLimiter, AuthController.register);
router.post("/login", authRateLimiter, AuthController.login);
router.post("/refresh", authRateLimiter, AuthController.refresh);
router.post("/logout", optionalAuth, AuthController.logout);
router.get("/me", requireAuth, AuthController.me);
router.post("/forgot-password", authRateLimiter, AuthController.forgotPassword);
router.post("/reset-password", authRateLimiter, AuthController.resetPassword);

router.post("/verify-email", authRateLimiter, AuthController.verifyEmail);
router.post("/resend-verification", authRateLimiter, AuthController.resendVerification);

// ── Google OAuth ──────────────────────────────────────────────────────
// Guarded the same way Stripe/eSewa/Khalti/Fonepay routes are guarded by
// their *Enabled flags — if the client hasn't handed over real Google OAuth
// credentials yet, these routes cleanly 404 instead of crashing the app
// (passport.authenticate would throw if the strategy was never registered).
if (googleAuthEnabled) {
  router.get(
    "/google",
    passport.authenticate("google", { scope: ["profile", "email"], session: false }),
  );

  router.get(
    "/google/callback",
    passport.authenticate("google", {
      session: false,
      failureRedirect: `${env.FRONTEND_URL}/login?error=google_auth_failed`,
    }),
    AuthController.googleCallback,
  );
}

router.post("/google/exchange", authRateLimiter, AuthController.googleExchange);

export default router;