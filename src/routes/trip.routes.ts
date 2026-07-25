import { Router } from "express";
import { Role } from "@prisma/client";
import * as TripController from "../controllers/trip.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import {
  uploadTripCover,
  uploadTripPhotos,
  uploadTripVideos,
} from "../middleware/upload.middleware.js";

const router = Router();

const organizerOrAdmin = requireRole(Role.ORGANIZER, Role.ADMIN);

// "mine" must be registered before "/:id" or it'll be parsed as a trip id.
router.get("/mine", requireAuth, organizerOrAdmin, TripController.getMyTrips);

router.get("/", TripController.getTrips);
// Must be registered before "/:id" or "regions" would be parsed as a trip id.
router.get("/regions", TripController.getRegions);
router.get("/:id", TripController.getTrip);

router.post("/", requireAuth, organizerOrAdmin, uploadTripCover, TripController.createTrip);
router.patch("/:id", requireAuth, organizerOrAdmin, uploadTripCover, TripController.updateTrip);
router.delete("/:id", requireAuth, organizerOrAdmin, TripController.deleteTrip);

// Gallery
router.post("/:id/photos", requireAuth, organizerOrAdmin, uploadTripPhotos, TripController.addTripPhotos);
router.delete("/:id/photos/:photoId", requireAuth, organizerOrAdmin, TripController.deleteTripPhoto);
router.post("/:id/videos", requireAuth, organizerOrAdmin, uploadTripVideos, TripController.addTripVideos);
router.delete("/:id/videos/:videoId", requireAuth, organizerOrAdmin, TripController.deleteTripVideo);

// Itinerary
router.post("/:id/itinerary", requireAuth, organizerOrAdmin, TripController.addItineraryDay);
router.patch("/:id/itinerary/:dayId", requireAuth, organizerOrAdmin, TripController.updateItineraryDay);
router.delete("/:id/itinerary/:dayId", requireAuth, organizerOrAdmin, TripController.deleteItineraryDay);

// Departures + guide assignment
router.post("/:id/departures", requireAuth, organizerOrAdmin, TripController.addTripDeparture);
router.patch("/:id/departures/:departureId", requireAuth, organizerOrAdmin, TripController.updateTripDeparture);
router.delete("/:id/departures/:departureId", requireAuth, organizerOrAdmin, TripController.deleteTripDeparture);
router.patch(
  "/:id/departures/:departureId/guide",
  requireAuth,
  organizerOrAdmin,
  TripController.assignGuide
);

// Translations (hybrid MT + organizer review) — machine drafts are generated
// automatically after create/update; these let an organizer/admin see and
// edit/approve them per locale.
router.get("/:id/translations", requireAuth, organizerOrAdmin, TripController.getTripTranslations);
router.patch("/:id/translations/:locale", requireAuth, organizerOrAdmin, TripController.upsertTripTranslation);
router.get(
  "/:id/itinerary/:dayId/translations",
  requireAuth,
  organizerOrAdmin,
  TripController.getItineraryDayTranslations
);
router.patch(
  "/:id/itinerary/:dayId/translations/:locale",
  requireAuth,
  organizerOrAdmin,
  TripController.upsertItineraryDayTranslation
);

export default router;