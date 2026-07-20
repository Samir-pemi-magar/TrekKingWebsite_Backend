import { Router } from "express";
import * as WishlistController from "../controllers/wishlist.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();

router.get("/", requireAuth, WishlistController.getMyWishlist);
router.post("/:tripId", requireAuth, WishlistController.addToWishlist);
router.delete("/:tripId", requireAuth, WishlistController.removeFromWishlist);

export default router;
