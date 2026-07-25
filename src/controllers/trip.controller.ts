import { NextFunction, Request, Response } from "express";
import { Difficulty, Role, TripType } from "@prisma/client";
import { z } from "zod";
import { ApiError } from "../utils/apiError.js";
import { requireStringParam } from "../utils/params.js";
import * as TripModel from "../models/trip.model.js";
import * as UserModel from "../models/user.model.js";
import { uploadBufferToCloudinary, uploadManyToCloudinary, deleteFromCloudinary } from "../utils/cloudinaryUpload.js";
import { recordAuditLog } from "../utils/auditLog.js";
import { isSupportedLocale } from "../config/locales.js";

// Pulls a validated `?locale=` off the query string. Only ever returns a
// value for locales we actually generate translations for — an unknown or
// missing locale (including the implicit "en") returns undefined, which
// downstream model functions treat as "just give me the English row".
function parseLocale(req: Request): string | undefined {
  const raw = req.query.locale;
  return typeof raw === "string" && isSupportedLocale(raw) ? raw : undefined;
}

const tripQuerySchema = z.object({
  // Free text now (Trip.region is no longer a Prisma enum) — trimmed so a
  // stray space doesn't silently fail to match any trips.
  region: z.string().trim().min(1).max(60).optional(),
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
  // Free text — admin/organizer can type any region name; no longer
  // restricted to a fixed enum (see schema.prisma).
  region: z.string().trim().min(1).max(60),
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

// Bodies for the translation-review endpoints — same shape as the source
// fields, all optional since an organizer might only fix one field of a
// machine draft.
const tripTranslationBodySchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  bestSeason: z.string().max(100).optional(),
  highlights: stringArrayField,
  includes: stringArrayField,
  excludes: stringArrayField,
});

const itineraryDayTranslationBodySchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  meals: z.string().max(120).optional(),
  accommodation: z.string().max(120).optional(),
});

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
    const result = await TripModel.listTrips(filters, parseLocale(req));
    res.json({ status: "success", data: result });
  } catch (err) {
    next(err);
  }
}

// Public — every distinct region currently in use, for the region filter
// dropdown and the trip form's region suggestions. Trip.region is free
// text now (see schema.prisma), so there's no fixed enum to read options
// from. Mounted at GET /trips/regions, ABOVE the /trips/:id route (see
// trip.routes.ts) so "regions" is never parsed as a trip id.
export async function getRegions(_req: Request, res: Response, next: NextFunction) {
  try {
    const regions = await TripModel.listDistinctRegions();
    res.json({ status: "success", data: regions });
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
    const trip = await TripModel.getTripById(id, parseLocale(req));
    if (!trip) throw ApiError.notFound("Trip not found");

    // Attach seats-remaining per departure for the client's booking UI.
    const departuresWithSeats = await Promise.all(
      trip.departures.map(async (d: any) => ({
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

    // Fire-and-forget: generates a MACHINE draft in every supported locale.
    // Deliberately not awaited — translation calls are slow (one round-trip
    // per field per locale) and their success/failure shouldn't hold up or
    // fail the trip creation response. Errors are logged, not thrown; a
    // failed locale just means that locale's trip page falls back to
    // English until the next update or a manual retry.
    TripModel.generateTripTranslations(trip.id, trip).catch((err) =>
      console.error(`[translations] generation failed for trip ${trip.id}`, err)
    );
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

    // Only re-translates locales that haven't been human-reviewed yet — see
    // the reviewedLocales check inside generateTripTranslations.
    TripModel.generateTripTranslations(trip.id, trip).catch((err) =>
      console.error(`[translations] regeneration failed for trip ${trip.id}`, err)
    );
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

    TripModel.generateItineraryDayTranslations(day.id, day).catch((err) =>
      console.error(`[translations] generation failed for itinerary day ${day.id}`, err)
    );
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

    TripModel.generateItineraryDayTranslations(updated.id, updated).catch((err) =>
      console.error(`[translations] regeneration failed for itinerary day ${updated.id}`, err)
    );
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

// ── Translations — organizer/admin review workflow ──────────────────────
// GET  /trips/:id/translations              → all locale drafts for a trip
// PATCH /trips/:id/translations/:locale      → edit/approve one locale's draft
// GET  /trips/:id/itinerary/:dayId/translations
// PATCH /trips/:id/itinerary/:dayId/translations/:locale
//
// All four require the same organizerOrAdmin + assertCanModify ownership
// check as the rest of the trip-editing endpoints, since translation drafts
// are just another editable facet of the trip.

export async function getTripTranslations(req: Request, res: Response, next: NextFunction) {
  try {
    const id = requireStringParam(req.params.id);
    const trip = await TripModel.getTripById(id);
    if (!trip) throw ApiError.notFound("Trip not found");
    assertCanModify(req, trip);

    const translations = await TripModel.getTripTranslations(id);
    res.json({ status: "success", data: translations });
  } catch (err) {
    next(err);
  }
}

export async function upsertTripTranslation(req: Request, res: Response, next: NextFunction) {
  try {
    const id = requireStringParam(req.params.id);
    const locale = requireStringParam(req.params.locale);
    if (!isSupportedLocale(locale)) throw ApiError.badRequest(`Unsupported locale: ${locale}`);

    const trip = await TripModel.getTripById(id);
    if (!trip) throw ApiError.notFound("Trip not found");
    assertCanModify(req, trip);

    const data = tripTranslationBodySchema.parse(req.body);
    const updated = await TripModel.upsertTripTranslation(id, locale, data, req.user!.userId);
    recordAuditLog({
      actorId: req.user?.userId,
      action: "trip.translation_reviewed",
      entityType: "Trip",
      entityId: id,
      meta: { locale },
    });
    res.json({ status: "success", data: updated });
  } catch (err) {
    next(err);
  }
}

export async function getItineraryDayTranslations(req: Request, res: Response, next: NextFunction) {
  try {
    const tripId = requireStringParam(req.params.id);
    const dayId = requireStringParam(req.params.dayId);
    const trip = await TripModel.getTripById(tripId);
    if (!trip) throw ApiError.notFound("Trip not found");
    assertCanModify(req, trip);

    const day = await TripModel.getItineraryDayById(dayId);
    if (!day || day.tripId !== tripId) throw ApiError.notFound("Itinerary day not found");

    const translations = await TripModel.getItineraryDayTranslations(dayId);
    res.json({ status: "success", data: translations });
  } catch (err) {
    next(err);
  }
}

export async function upsertItineraryDayTranslation(req: Request, res: Response, next: NextFunction) {
  try {
    const tripId = requireStringParam(req.params.id);
    const dayId = requireStringParam(req.params.dayId);
    const locale = requireStringParam(req.params.locale);
    if (!isSupportedLocale(locale)) throw ApiError.badRequest(`Unsupported locale: ${locale}`);

    const trip = await TripModel.getTripById(tripId);
    if (!trip) throw ApiError.notFound("Trip not found");
    assertCanModify(req, trip);

    const day = await TripModel.getItineraryDayById(dayId);
    if (!day || day.tripId !== tripId) throw ApiError.notFound("Itinerary day not found");

    const data = itineraryDayTranslationBodySchema.parse(req.body);
    const updated = await TripModel.upsertItineraryDayTranslation(dayId, locale, data, req.user!.userId);
    res.json({ status: "success", data: updated });
  } catch (err) {
    next(err);
  }
}