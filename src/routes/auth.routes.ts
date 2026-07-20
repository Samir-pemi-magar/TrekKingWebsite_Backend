import { Router } from "express";
import * as AuthController from "../controllers/auth.controller.js";
import { requireAuth, optionalAuth } from "../middleware/auth.middleware.js";
import { authRateLimiter } from "../middleware/rateLimiter.middleware.js";

const router = Router();

router.post("/register", authRateLimiter, AuthController.register);
router.post("/login", authRateLimiter, AuthController.login);
router.post("/refresh", authRateLimiter, AuthController.refresh);
router.post("/logout", optionalAuth, AuthController.logout);
router.get("/me", requireAuth, AuthController.me);
router.post("/forgot-password", authRateLimiter, AuthController.forgotPassword);
router.post("/reset-password", authRateLimiter, AuthController.resetPassword);

export default router;