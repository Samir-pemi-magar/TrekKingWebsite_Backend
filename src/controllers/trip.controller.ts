import { NextFunction, Request, Response } from "express";
import { Difficulty, Region, Role, TripType } from "@prisma/client";
import { z } from "zod";
import { ApiError } from "../utils/apiError.js";
import { requireStringParam } from "../utils/params.js";
import * as TripModel from "../models/trip.model.js";
import * as UserModel from "../models/user.model.js";
import { uploadBufferToCloudinary, uploadManyToCloudinary, deleteFromCloudinary } from "../utils/cloudinaryUpload.js";
import { recordAuditLog } from "../utils/auditLog.js";

const tripQuerySchema = z.object({
  region: z.nativeEnum(Region).optional(),
  difficulty: z.nativeEnum(Difficulty).optional(),
  type: z.nativeEnum(TripType).optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(50).optional(),
  search: z.string().min(1).max(200).optional(),
});

// The create/update routes go through multer (uploadTripCover) because they
// accept an optional cover image file, which means the request is
// multipart/form-data, not application/json. Every field — including
// arrays — arrives in req.body as a plain string. The frontend
// JSON.stringifies array fields before appending them to FormData (e.g.
// '["Testing"]'), so this preprocessor JSON-parses string values back into
// real arrays before validation. Real arrays (e.g. a future JSON-body
// caller) are left untouched.
const stringArrayField = z.preprocess((val) => {
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Not JSON — fall through and let the array schema below reject it
      // with a clear error instead of silently swallowing bad input.
    }
  }
  return val;
}, z.array(z.string().min(1)).optional());

const tripBodySchema = z.object({
  name: z.string().min(1),
  region: z.nativeEnum(Region),
  location: z.string().min(1).optional(),
  duration: z.coerce.number().int().positive(),
  difficulty: z.nativeEnum(Difficulty),
  price: z.coerce.number().int().nonnegative(),
  description: z.string().min(1),
  type: z.nativeEnum(TripType).optional(),
  bestSeason: z.string().max(100).optional(),
  maxAltitudeM: z.coerce.number().int().positive().optional(),
  highlights: stringArrayField,
  includes: stringArrayField,
  excludes: stringArrayField,
});

const departureSchema = z.object({
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
  note: z.string().max(280).optional(),
  maxSeats: z.coerce.number().int().positive().optional(),
  guideId: z.string().uuid().optional(),
});

const itineraryDaySchema = z.object({
  dayNumber: z.coerce.number().int().positive(),
  title: z.string().min(1),
  description: z.string().min(1),
  meals: z.string().max(120).optional(),
  accommodation: z.string().max(120).optional(),
  altitudeM: z.coerce.number().int().positive().optional(),
  distanceKm: z.coerce.number().positive().optional(),
});

const guideAssignSchema = z.object({ guideId: z.string().uuid().nullable() });

// Admins can touch anything; Organizers only their own trips.
function assertCanModify(req: Request, trip: { organizerId: string | null }) {
  if (req.user?.role === Role.ADMIN) return;
  if (req.user?.role === Role.ORGANIZER && trip.organizerId === req.user.userId) return;
  throw ApiError.forbidden("You can only manage trips you organize");
}

// Public — browse all trips, no auth required. ?search= does a basic
// name/description/location match. ?type=FIXED_DEPARTURE for planned group
// trips, ?type=AVAILABLE for the flexible/bookable catalog.
export async function getTrips(req: Request, res: Response, next: NextFunction) {
  try {
    const filters = tripQuerySchema.parse(req.query);
    const result = await TripModel.listTrips(filters);
    res.json({ status: "success", data: result });
  } catch (err) {
    next(err);
  }
}

// Auth required (ORGANIZER or ADMIN). Organizers see only their own trips;
// Admins see everything. Mount at GET /trips/mine, ABOVE the /trips/:id route.
export async function getMyTrips(req: Request, res: Response, next: NextFunction) {
  try {
    const filters = tripQuerySchema.parse(req.query);
    const scoped = req.user!.role === Role.ADMIN ? filters : { ...filters, organizerId: req.user!.userId };
    const result = await TripModel.listTrips(scoped);
    res.json({ status: "success", data: result });
  } catch (err) {
    next(err);
  }
}

export async function getTrip(req: Request, res: Response, next: NextFunction) {
  try {
    const id = requireStringParam(req.params.id);
    const trip = await TripModel.getTripById(id);
    if (!trip) throw ApiError.notFound("Trip not found");

    // Attach seats-remaining per departure for the client's booking UI.
    const departuresWithSeats = await Promise.all(
      trip.departures.map(async (d) => ({
        ...d,
        seatsRemaining: await TripModel.getDepartureSeatsRemaining(d.id),
      }))
    );

    res.json({ status: "success", data: { ...trip, departures: departuresWithSeats } });
  } catch (err) {
    next(err);
  }
}

// ORGANIZER or ADMIN. A trip created by an Organizer is automatically owned
// by them; a trip created by an Admin has no organizer unless the Admin
// explicitly assigns one via `organizerId` in the body.
export async function createTrip(req: Request, res: Response, next: NextFunction) {
  try {
    const data = tripBodySchema.parse(req.body);
    const organizerId = req.user!.role === Role.ORGANIZER ? req.user!.userId : req.body.organizerId ?? null;

    let coverImageUrl: string | undefined;
    let coverImagePublicId: string | undefined;
    if (req.file) {
      const uploaded = await uploadBufferToCloudinary(req.file.buffer, "trips/covers", "image");
      coverImageUrl = uploaded.url;
      coverImagePublicId = uploaded.publicId;
    }

    const trip = await TripModel.createTrip({
      ...data,
      organizerId,
      ...(coverImageUrl ? { coverImageUrl, coverImagePublicId } : {}),
    });
    recordAuditLog({ actorId: req.user?.userId, action: "trip.created", entityType: "Trip", entityId: trip.id });
    res.status(201).json({ status: "success", data: trip });
  } catch (err) {
    next(err);
  }
}

export async function updateTrip(req: Request, res: Response, next: NextFunction) {
  try {
    const id = requireStringParam(req.params.id);
    const data = tripBodySchema.partial().parse(req.body);
    const existing = await TripModel.getTripById(id);
    if (!existing) throw ApiError.notFound("Trip not found");

    assertCanModify(req, existing);

    let coverPatch = {};
    if (req.file) {
      const uploaded = await uploadBufferToCloudinary(req.file.buffer, "trips/covers", "image");
      if (existing.coverImagePublicId) {
        await deleteFromCloudinary(existing.coverImagePublicId, "image");
      }
      coverPatch = { coverImageUrl: uploaded.url, coverImagePublicId: uploaded.publicId };
    }

    const trip = await TripModel.updateTrip(id, { ...data, ...coverPatch });
    res.json({ status: "success", data: trip });
  } catch (err) {
    next(err);
  }
}

export async function deleteTrip(req: Request, res: Response, next: NextFunction) {
  try {
    const id = requireStringParam(req.params.id);
    const existing = await TripModel.getTripById(id);
    if (!existing) throw ApiError.notFound("Trip not found");

    assertCanModify(req, existing);

    // Cover image is removed from Cloudinary; the trip row itself is only
    // soft-deleted so historical bookings/reviews remain intact.
    if (existing.coverImagePublicId) {
      await deleteFromCloudinary(existing.coverImagePublicId, "image");
    }
    await TripModel.deleteTrip(id);
    recordAuditLog({ actorId: req.user?.userId, action: "trip.deleted", entityType: "Trip", entityId: id });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// ── Gallery photos ──────────────────────────────────────────────────────
export async function addTripPhotos(req: Request, res: Response, next: NextFunction) {
  try {
    const id = requireStringParam(req.params.id);
    const existing = await TripModel.getTripById(id);
    if (!existing) throw ApiError.notFound("Trip not found");
    assertCanModify(req, existing);

    const files = (req.files as Express.Multer.File[]) ?? [];
    if (files.length === 0) throw ApiError.badRequest("No photos provided");

    const uploaded = await uploadManyToCloudinary(files, `trips/${id}/photos`, "image");
    await TripModel.addTripPhotos(
      id,
      uploaded.map((u, i) => ({ url: u.url, publicId: u.publicId, order: i }))
    );

    const trip = await TripModel.getTripById(id);
    res.status(201).json({ status: "success", data: trip });
  } catch (err) {
    next(err);
  }
}

export async function deleteTripPhoto(req: Request, res: Response, next: NextFunction) {
  try {
    const tripId = requireStringParam(req.params.id);
    const photoId = requireStringParam(req.params.photoId);
    const trip = await TripModel.getTripById(tripId);
    if (!trip) throw ApiError.notFound("Trip not found");
    assertCanModify(req, trip);

    const photo = await TripModel.getTripPhotoById(photoId);
    if (!photo || photo.tripId !== tripId) throw ApiError.notFound("Photo not found");

    if (photo.publicId) await deleteFromCloudinary(photo.publicId, "image");
    await TripModel.deleteTripPhoto(photoId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// ── Gallery videos ──────────────────────────────────────────────────────
export async function addTripVideos(req: Request, res: Response, next: NextFunction) {
  try {
    const id = requireStringParam(req.params.id);
    const existing = await TripModel.getTripById(id);
    if (!existing) throw ApiError.notFound("Trip not found");
    assertCanModify(req, existing);

    const files = (req.files as Express.Multer.File[]) ?? [];
    if (files.length === 0) throw ApiError.badRequest("No videos provided");

    const uploaded = await uploadManyToCloudinary(files, `trips/${id}/videos`, "video");
    await TripModel.addTripVideos(
      id,
      uploaded.map((u, i) => ({ url: u.url, publicId: u.publicId, thumbnailUrl: u.thumbnailUrl, order: i }))
    );

    const trip = await TripModel.getTripById(id);
    res.status(201).json({ status: "success", data: trip });
  } catch (err) {
    next(err);
  }
}

export async function deleteTripVideo(req: Request, res: Response, next: NextFunction) {
  try {
    const tripId = requireStringParam(req.params.id);
    const videoId = requireStringParam(req.params.videoId);
    const trip = await TripModel.getTripById(tripId);
    if (!trip) throw ApiError.notFound("Trip not found");
    assertCanModify(req, trip);

    const video = await TripModel.getTripVideoById(videoId);
    if (!video || video.tripId !== tripId) throw ApiError.notFound("Video not found");

    if (video.publicId) await deleteFromCloudinary(video.publicId, "video");
    await TripModel.deleteTripVideo(videoId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// ── Itinerary — POST/PATCH/DELETE /trips/:id/itinerary(/:dayId) ─────────
export async function addItineraryDay(req: Request, res: Response, next: NextFunction) {
  try {
    const id = requireStringParam(req.params.id);
    const existing = await TripModel.getTripById(id);
    if (!existing) throw ApiError.notFound("Trip not found");
    assertCanModify(req, existing);

    const data = itineraryDaySchema.parse(req.body);
    const day = await TripModel.addItineraryDay(id, data);
    res.status(201).json({ status: "success", data: day });
  } catch (err) {
    next(err);
  }
}

export async function updateItineraryDay(req: Request, res: Response, next: NextFunction) {
  try {
    const tripId = requireStringParam(req.params.id);
    const dayId = requireStringParam(req.params.dayId);
    const trip = await TripModel.getTripById(tripId);
    if (!trip) throw ApiError.notFound("Trip not found");
    assertCanModify(req, trip);

    const day = await TripModel.getItineraryDayById(dayId);
    if (!day || day.tripId !== tripId) throw ApiError.notFound("Itinerary day not found");

    const data = itineraryDaySchema.partial().parse(req.body);
    const updated = await TripModel.updateItineraryDay(dayId, data);
    res.json({ status: "success", data: updated });
  } catch (err) {
    next(err);
  }
}

export async function deleteItineraryDay(req: Request, res: Response, next: NextFunction) {
  try {
    const tripId = requireStringParam(req.params.id);
    const dayId = requireStringParam(req.params.dayId);
    const trip = await TripModel.getTripById(tripId);
    if (!trip) throw ApiError.notFound("Trip not found");
    assertCanModify(req, trip);

    const day = await TripModel.getItineraryDayById(dayId);
    if (!day || day.tripId !== tripId) throw ApiError.notFound("Itinerary day not found");

    await TripModel.deleteItineraryDay(dayId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// ── Departures + guide assignment ───────────────────────────────────────
// Clients "join" a departure by submitting a Booking against this trip's id
// (see booking.controller.ts) — capacity is enforced there via maxSeats.
export async function addTripDeparture(req: Request, res: Response, next: NextFunction) {
  try {
    const id = requireStringParam(req.params.id);
    const existing = await TripModel.getTripById(id);
    if (!existing) throw ApiError.notFound("Trip not found");
    assertCanModify(req, existing);

    const data = departureSchema.parse(req.body);
    if (data.guideId) {
      const guide = await UserModel.getUserById(data.guideId);
      if (!guide || guide.role !== Role.GUIDE) throw ApiError.badRequest("guideId must reference a GUIDE user");
    }

    const departure = await TripModel.addTripDeparture(id, data);
    res.status(201).json({ status: "success", data: departure });
  } catch (err) {
    next(err);
  }
}

export async function updateTripDeparture(req: Request, res: Response, next: NextFunction) {
  try {
    const tripId = requireStringParam(req.params.id);
    const departureId = requireStringParam(req.params.departureId);
    const trip = await TripModel.getTripById(tripId);
    if (!trip) throw ApiError.notFound("Trip not found");
    assertCanModify(req, trip);

    const existingDeparture = await TripModel.getTripDepartureById(departureId);
    if (!existingDeparture) throw ApiError.notFound("Departure not found");

    const data = departureSchema.partial().parse(req.body);
    const updated = await TripModel.updateTripDeparture(departureId, data);
    res.json({ status: "success", data: updated });
  } catch (err) {
    next(err);
  }
}

export async function deleteTripDeparture(req: Request, res: Response, next: NextFunction) {
  try {
    const tripId = requireStringParam(req.params.id);
    const departureId = requireStringParam(req.params.departureId);
    const trip = await TripModel.getTripById(tripId);
    if (!trip) throw ApiError.notFound("Trip not found");
    assertCanModify(req, trip);

    const departure = await TripModel.getTripDepartureById(departureId);
    if (!departure || departure.tripId !== tripId) throw ApiError.notFound("Departure not found");

    await TripModel.deleteTripDeparture(departureId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// PATCH /trips/:id/departures/:departureId/guide  { guideId: string | null }
export async function assignGuide(req: Request, res: Response, next: NextFunction) {
  try {
    const tripId = requireStringParam(req.params.id);
    const departureId = requireStringParam(req.params.departureId);
    const trip = await TripModel.getTripById(tripId);
    if (!trip) throw ApiError.notFound("Trip not found");
    assertCanModify(req, trip);

    const departure = await TripModel.getTripDepartureById(departureId);
    if (!departure || departure.tripId !== tripId) throw ApiError.notFound("Departure not found");

    const { guideId } = guideAssignSchema.parse(req.body);
    if (guideId) {
      const guide = await UserModel.getUserById(guideId);
      if (!guide || guide.role !== Role.GUIDE) throw ApiError.badRequest("guideId must reference a GUIDE user");
    }

    const updated = await TripModel.assignGuideToDeparture(departureId, guideId);
    recordAuditLog({
      actorId: req.user?.userId,
      action: "departure.guide_assigned",
      entityType: "TripDeparture",
      entityId: departureId,
      meta: { guideId },
    });
    res.json({ status: "success", data: updated });
  } catch (err) {
    next(err);
  }
}