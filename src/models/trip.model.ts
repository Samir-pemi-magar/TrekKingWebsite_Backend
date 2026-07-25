import { Prisma, Difficulty, TripType, TranslationSource } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { SUPPORTED_LOCALES } from "../config/locales.js";
import { translateFields } from "../utils/translate.js";

export interface TripFilters {
  region?: string;
  difficulty?: Difficulty;
  type?: TripType;
  minPrice?: number;
  maxPrice?: number;
  page?: number;
  pageSize?: number;
  organizerId?: string;
  search?: string;
}

const tripInclude = {
  photos: { orderBy: { order: "asc" } },
  videos: { orderBy: { order: "asc" } },
  itinerary: { orderBy: { dayNumber: "asc" } },
  departures: {
    orderBy: { startDate: "asc" },
    include: {
      guide: { select: { id: true, name: true, avatarUrl: true, phone: true } },
      _count: { select: { bookings: true } },
    },
  },
  organizer: { select: { id: true, name: true, email: true, avatarUrl: true, bio: true } },
  _count: { select: { reviews: true } },
} satisfies Prisma.TripInclude;

// Overlays a TripTranslation onto its parent Trip's user-facing fields.
// English (the columns on Trip itself) is always the source of truth and
// the fallback — if no translation row exists yet for the requested locale
// (still being generated, or generation failed), we silently fall back to
// English rather than showing an error or empty fields.
function applyTripTranslation<T extends { id: string; bestSeason?: string | null }>(
  trip: T,
  translation: Prisma.TripTranslationGetPayload<{}> | undefined
): T & { translationStatus: TranslationSource | "UNTRANSLATED" } {
  if (!translation) return { ...trip, translationStatus: "UNTRANSLATED" as const };
  return {
    ...trip,
    name: translation.name,
    description: translation.description,
    bestSeason: translation.bestSeason ?? trip.bestSeason,
    highlights: translation.highlights,
    includes: translation.includes,
    excludes: translation.excludes,
    translationStatus: translation.source,
  } as any;
}

function applyItineraryDayTranslation<T extends { id: string; meals?: string | null; accommodation?: string | null }>(
  day: T,
  translation: Prisma.ItineraryDayTranslationGetPayload<{}> | undefined
): T {
  if (!translation) return day;
  return {
    ...day,
    title: translation.title,
    description: translation.description,
    meals: translation.meals ?? day.meals,
    accommodation: translation.accommodation ?? day.accommodation,
  };
}

// Every distinct region currently in use across non-deleted trips. Since
// Trip.region is free text (any admin/organizer can type a new one when
// creating a trip), this is how the UI offers "regions that already exist"
// as suggestions/filter options instead of a fixed list.
export async function listDistinctRegions(): Promise<string[]> {
  const rows = await prisma.trip.findMany({
    where: { deletedAt: null },
    distinct: ["region"],
    select: { region: true },
    orderBy: { region: "asc" },
  });
  return rows.map((r) => r.region);
}

export async function listTrips(filters: TripFilters, locale?: string) {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 20;

  const where: Prisma.TripWhereInput = {
    deletedAt: null,
    // Case-insensitive exact match — region is free text now, so "Himalaya"
    // and "himalaya" should filter the same rather than needing an exact
    // case match.
    ...(filters.region ? { region: { equals: filters.region, mode: "insensitive" } } : {}),
    ...(filters.difficulty ? { difficulty: filters.difficulty } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.organizerId ? { organizerId: filters.organizerId } : {}),
    ...(filters.minPrice !== undefined || filters.maxPrice !== undefined
      ? { price: { gte: filters.minPrice, lte: filters.maxPrice } }
      : {}),
    ...(filters.search
      ? {
          OR: [
            { name: { contains: filters.search, mode: "insensitive" } },
            { description: { contains: filters.search, mode: "insensitive" } },
            { location: { contains: filters.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.trip.findMany({
      where,
      include: {
        ...tripInclude,
        translations: locale ? { where: { locale } } : false,
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.trip.count({ where }),
  ]);

  // Rating average is computed separately (avg() doesn't come free with findMany).
  const ratings = await prisma.review.groupBy({
    by: ["tripId"],
    where: { tripId: { in: items.map((t) => t.id) } },
    _avg: { rating: true },
  });
  const ratingByTrip = new Map(ratings.map((r) => [r.tripId, r._avg.rating]));

  return {
    items: items.map((t: any) => {
      const withRating = { ...t, averageRating: ratingByTrip.get(t.id) ?? null };
      if (!locale) return withRating;
      const { translations, ...rest } = withRating;
      return applyTripTranslation(rest, translations?.[0]);
    }),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

// `locale` is optional and only changes behavior when it's one of
// SUPPORTED_LOCALES — passing "en" or omitting it both just return the
// canonical English row untouched.
export async function getTripById(id: string, locale?: string) {
  const trip = await prisma.trip.findFirst({
    where: { id, deletedAt: null },
    include: {
      ...tripInclude,
      translations: locale ? { where: { locale } } : false,
      itinerary: {
        orderBy: { dayNumber: "asc" },
        include: { translations: locale ? { where: { locale } } : false },
      },
    },
  });
  if (!trip || !locale) return trip;

  const { translations, itinerary, ...rest } = trip as any;
  return {
    ...applyTripTranslation(rest, translations?.[0]),
    itinerary: itinerary.map((day: any) => {
      const { translations: dayTranslations, ...dayRest } = day;
      return applyItineraryDayTranslation(dayRest, dayTranslations?.[0]);
    }),
  };
}

export interface TripCreateInput {
  name: string;
  region: string;
  location?: string;
  duration: number;
  difficulty: Difficulty;
  price: number;
  description: string;
  type?: TripType;
  bestSeason?: string;
  maxAltitudeM?: number;
  highlights?: string[];
  includes?: string[];
  excludes?: string[];
  organizerId?: string | null;
  coverImageUrl?: string;
  coverImagePublicId?: string;
}

export function createTrip(data: TripCreateInput) {
  return prisma.trip.create({ data, include: tripInclude });
}

export function updateTrip(id: string, data: Partial<TripCreateInput>) {
  return prisma.trip.update({ where: { id }, data, include: tripInclude });
}

// Soft delete — trips can have real financial history (bookings, reviews)
// attached, so we never hard-delete them.
export function deleteTrip(id: string) {
  return prisma.trip.update({ where: { id }, data: { deletedAt: new Date() } });
}

// ── Gallery photos ──────────────────────────────────────────────────────
export function addTripPhotos(tripId: string, photos: { url: string; publicId: string; order: number }[]) {
  return prisma.tripPhoto.createMany({ data: photos.map((p) => ({ ...p, tripId })) });
}

export function getTripPhotoById(id: string) {
  return prisma.tripPhoto.findUnique({ where: { id } });
}

export function deleteTripPhoto(id: string) {
  return prisma.tripPhoto.delete({ where: { id } });
}

// ── Gallery videos ──────────────────────────────────────────────────────
export function addTripVideos(
  tripId: string,
  videos: { url: string; publicId: string; thumbnailUrl?: string; order: number }[]
) {
  return prisma.tripVideo.createMany({ data: videos.map((v) => ({ ...v, tripId })) });
}

export function getTripVideoById(id: string) {
  return prisma.tripVideo.findUnique({ where: { id } });
}

export function deleteTripVideo(id: string) {
  return prisma.tripVideo.delete({ where: { id } });
}

// ── Itinerary days ──────────────────────────────────────────────────────
export interface ItineraryDayInput {
  dayNumber: number;
  title: string;
  description: string;
  meals?: string;
  accommodation?: string;
  altitudeM?: number;
  distanceKm?: number;
}

export function addItineraryDay(tripId: string, data: ItineraryDayInput) {
  return prisma.itineraryDay.create({ data: { ...data, tripId } });
}

export function getItineraryDayById(id: string) {
  return prisma.itineraryDay.findUnique({ where: { id } });
}

export function updateItineraryDay(id: string, data: Partial<ItineraryDayInput>) {
  return prisma.itineraryDay.update({ where: { id }, data });
}

export function deleteItineraryDay(id: string) {
  return prisma.itineraryDay.delete({ where: { id } });
}

// ── Departures + guide assignment ───────────────────────────────────────
export interface DepartureInput {
  startDate: Date;
  endDate?: Date;
  note?: string;
  maxSeats?: number;
  guideId?: string | null;
}

export function addTripDeparture(tripId: string, data: DepartureInput) {
  return prisma.tripDeparture.create({ data: { ...data, tripId } });
}

export function getTripDepartureById(id: string) {
  return prisma.tripDeparture.findUnique({
    where: { id },
    include: { _count: { select: { bookings: true } } },
  });
}

export function updateTripDeparture(id: string, data: Partial<DepartureInput>) {
  return prisma.tripDeparture.update({ where: { id }, data });
}

export function deleteTripDeparture(id: string) {
  return prisma.tripDeparture.delete({ where: { id } });
}

export function assignGuideToDeparture(departureId: string, guideId: string | null) {
  return prisma.tripDeparture.update({ where: { id: departureId }, data: { guideId } });
}

// Seats remaining = maxSeats - sum(travelers) across active (non-cancelled) bookings.
export async function getDepartureSeatsRemaining(departureId: string): Promise<number | null> {
  const departure = await prisma.tripDeparture.findUnique({ where: { id: departureId } });
  if (!departure || departure.maxSeats == null) return null;

  const booked = await prisma.booking.aggregate({
    where: { departureId, status: { not: "CANCELLED" } },
    _sum: { travelers: true },
  });
  return departure.maxSeats - (booked._sum.travelers ?? 0);
}

// ── Translations (hybrid MT + organizer review) ─────────────────────────
//
// Called after create/update of a Trip. Generates a MACHINE draft for every
// supported locale that hasn't already been REVIEWED by a human — a
// reviewed/edited translation must never be silently clobbered by a later
// auto-retranslate when the organizer tweaks an unrelated field. Per-locale
// failures (rate limit, provider outage, one bad language code) are caught
// individually so one failing locale doesn't take down the others or the
// trip save itself; callers should treat this as fire-and-forget (see
// trip.controller.ts) rather than awaiting it in the request/response path.
export async function generateTripTranslations(
  tripId: string,
  trip: { name: string; description: string; bestSeason?: string | null; highlights: string[]; includes: string[]; excludes: string[] }
) {
  const existing = await prisma.tripTranslation.findMany({ where: { tripId } });
  const reviewedLocales = new Set(
    existing.filter((t: { source: string; locale: string }) => t.source === "REVIEWED").map((t) => t.locale)
  );
  const targets = SUPPORTED_LOCALES.filter((l) => !reviewedLocales.has(l));

  return Promise.allSettled(
    targets.map(async (locale) => {
      const translated = await translateFields(
        {
          name: trip.name,
          description: trip.description,
          bestSeason: trip.bestSeason ?? undefined,
          highlights: trip.highlights,
          includes: trip.includes,
          excludes: trip.excludes,
        },
        locale
      );
      return prisma.tripTranslation.upsert({
        where: { tripId_locale: { tripId, locale } },
        update: { ...translated, source: "MACHINE" },
        create: { tripId, locale, ...translated, source: "MACHINE" } as any,
      });
    })
  );
}

export function getTripTranslations(tripId: string) {
  return prisma.tripTranslation.findMany({ where: { tripId }, orderBy: { locale: "asc" } });
}

export interface TripTranslationInput {
  name?: string;
  description?: string;
  bestSeason?: string;
  highlights?: string[];
  includes?: string[];
  excludes?: string[];
}

// Used by the organizer/admin review UI — always marks the row REVIEWED,
// since a human explicitly saved it (whether they wrote it from scratch or
// just tweaked the machine draft). This is what protects it from being
// overwritten the next time generateTripTranslations runs.
export function upsertTripTranslation(
  tripId: string,
  locale: string,
  data: TripTranslationInput,
  reviewedBy?: string
) {
  return prisma.tripTranslation.upsert({
    where: { tripId_locale: { tripId, locale } },
    update: { ...data, source: "REVIEWED", reviewedAt: new Date(), reviewedBy },
    create: {
      tripId,
      locale,
      name: "",
      description: "",
      ...data,
      source: "REVIEWED",
      reviewedAt: new Date(),
      reviewedBy,
    } as any,
  });
}

// Same pattern as generateTripTranslations, one level down. Kept separate
// (rather than folded into the trip-level function) because itinerary days
// are added/edited independently of the parent trip.
export async function generateItineraryDayTranslations(
  itineraryDayId: string,
  day: { title: string; description: string; meals?: string | null; accommodation?: string | null }
) {
  const existing = await prisma.itineraryDayTranslation.findMany({ where: { itineraryDayId } });
  const reviewedLocales = new Set(
    existing.filter((t: { source: string; locale: string }) => t.source === "REVIEWED").map((t) => t.locale)
  );
  const targets = SUPPORTED_LOCALES.filter((l) => !reviewedLocales.has(l));

  return Promise.allSettled(
    targets.map(async (locale) => {
      const translated = await translateFields(
        {
          title: day.title,
          description: day.description,
          meals: day.meals ?? undefined,
          accommodation: day.accommodation ?? undefined,
        },
        locale
      );
      return prisma.itineraryDayTranslation.upsert({
        where: { itineraryDayId_locale: { itineraryDayId, locale } },
        update: { ...translated, source: "MACHINE" },
        create: { itineraryDayId, locale, ...translated, source: "MACHINE" } as any,
      });
    })
  );
}

export function getItineraryDayTranslations(itineraryDayId: string) {
  return prisma.itineraryDayTranslation.findMany({ where: { itineraryDayId }, orderBy: { locale: "asc" } });
}

export interface ItineraryDayTranslationInput {
  title?: string;
  description?: string;
  meals?: string;
  accommodation?: string;
}

export function upsertItineraryDayTranslation(
  itineraryDayId: string,
  locale: string,
  data: ItineraryDayTranslationInput,
  reviewedBy?: string
) {
  return prisma.itineraryDayTranslation.upsert({
    where: { itineraryDayId_locale: { itineraryDayId, locale } },
    update: { ...data, source: "REVIEWED", reviewedAt: new Date(), reviewedBy },
    create: {
      itineraryDayId,
      locale,
      title: "",
      description: "",
      ...data,
      source: "REVIEWED",
      reviewedAt: new Date(),
      reviewedBy,
    } as any,
  });
}