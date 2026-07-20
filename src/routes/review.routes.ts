import { Router } from "express";
import * as ReviewController from "../controllers/review.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();

// /mine is registered before /trip/:tripId and /:id so it's never
// swallowed as a route param.
router.get("/mine", requireAuth, ReviewController.getMyReviews);
router.get("/trip/:tripId", ReviewController.getTripReviews);
router.post("/trip/:tripId", requireAuth, ReviewController.createReview);
router.patch("/:id", requireAuth, ReviewController.updateReview);
router.delete("/:id", requireAuth, ReviewController.deleteReview);

export default router;