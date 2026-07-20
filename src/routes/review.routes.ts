import { Router } from "express";
import * as ReviewController from "../controllers/review.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();

router.get("/trip/:tripId", ReviewController.getTripReviews);
router.post("/trip/:tripId", requireAuth, ReviewController.createReview);
router.delete("/:id", requireAuth, ReviewController.deleteReview);

export default router;
