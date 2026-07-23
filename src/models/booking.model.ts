import { Prisma, BookingStatus, PaymentStatus, PaymentMethod, ChangeRequestStatus } from "@prisma/client";
import { prisma } from "../config/prisma.js";

const bookingInclude = {
  trip: { select: { id: true, name: true, price: true, organizerId: true, coverImageUrl: true } },
  departure: { select: { id: true, startDate: true, endDate: true, guideId: true } },
  user: { select: { id: true, name: true, email: true, phone: true } },
  // Only the live (PENDING) request, if any — lets both the customer's
  // account page and the staff dashboard show "change requested" without a
  // second round-trip. A booking's approved/declined history isn't needed
  // inline here; it's fetched separately if staff want the full log.
  changeRequests: {
    where: { status: ChangeRequestStatus.PENDING },
    orderBy: { createdAt: "desc" as const },
    take: 1,
  },
} satisfies Prisma.BookingInclude;

export interface BookingCreateInput {
  tripId: string;
  departureId?: string;
  userId?: string;
  guestName?: string;
  guestEmail?: string;
  guestPhone?: string;
  travelers: number;
  totalPrice: number;
  notes?: string;
}

export function createBooking(data: BookingCreateInput) {
  return prisma.booking.create({ data, include: bookingInclude });
}

export function getBookingById(id: string) {
  return prisma.booking.findUnique({ where: { id }, include: bookingInclude });
}

// ── Idempotency (BookingAttempt) ────────────────────────────────────────
// See the BookingAttempt model comment in schema.prisma for why this is a
// separate table instead of a column on Booking.

export function findBookingAttempt(idempotencyKey: string) {
  return prisma.bookingAttempt.findUnique({ where: { idempotencyKey } });
}

export function recordBookingAttempt(idempotencyKey: string, bookingId: string) {
  return prisma.bookingAttempt.create({ data: { idempotencyKey, bookingId } });
}

// A logged-in customer's own existing booking for this exact departure, if
// they already have one that isn't cancelled — the "same trip, same day/
// month/year" match the controller merges new travelers into instead of
// creating a look-alike duplicate row.
export function findActiveBookingForUserDeparture(userId: string, departureId: string) {
  return prisma.booking.findFirst({
    where: { userId, departureId, status: { not: BookingStatus.CANCELLED } },
    include: bookingInclude,
  });
}

// Same idea for a guest checkout — matched on email instead of a userId,
// since guests have none. Used purely to stop a repeated "Book" click (or a
// resubmitted form) from piling up look-alike rows; guests have no session
// to later submit an authenticated change-request through, so this is only
// ever surfaced back to them as "you already have a booking for this date",
// never auto-merged and never turned into a BookingChangeRequest.
export function findActiveBookingForGuestDeparture(guestEmail: string, departureId: string) {
  return prisma.booking.findFirst({
    where: {
      guestEmail,
      departureId,
      userId: null,
      status: { not: BookingStatus.CANCELLED },
    },
    include: bookingInclude,
  });
}

// Folds additional travelers into an existing booking rather than creating
// a new one. Recomputes totalPrice for the new traveler count and re-derives
// paymentStatus against the amount already paid — e.g. a booking that was
// fully PAID can correctly drop back to PARTIAL once more (unpaid-for)
// travelers are added to it, rather than staying stuck showing "Paid" for
// money that no longer covers the whole party. Runs as a transaction so the
// read-then-write can't race against a concurrent update to the same row.
export function addTravelersToBooking(id: string, additionalTravelers: number, pricePerTraveler: number) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.booking.findUniqueOrThrow({ where: { id } });
    const travelers = existing.travelers + additionalTravelers;
    const totalPrice = pricePerTraveler * travelers;
    const paymentStatus = derivePaymentStatus(existing.amountPaid, totalPrice);
    return tx.booking.update({
      where: { id },
      data: { travelers, totalPrice, paymentStatus },
      include: bookingInclude,
    });
  });
}

// ── Change requests (traveler-count increases) ──────────────────────────
// See the BookingChangeRequest model comment in schema.prisma for why this
// is a request/review workflow instead of the old silent auto-merge.

export function findPendingChangeRequestForBooking(bookingId: string) {
  return prisma.bookingChangeRequest.findFirst({
    where: { bookingId, status: ChangeRequestStatus.PENDING },
  });
}

export interface ChangeRequestCreateInput {
  bookingId: string;
  requestedTravelers: number;
  additionalTravelers: number;
  note?: string;
  requestedByUserId: string;
}

export function createChangeRequest(data: ChangeRequestCreateInput) {
  return prisma.bookingChangeRequest.create({ data });
}

const changeRequestInclude = {
  booking: { include: bookingInclude },
} satisfies Prisma.BookingChangeRequestInclude;

export function getChangeRequestById(id: string) {
  return prisma.bookingChangeRequest.findUnique({
    where: { id },
    include: changeRequestInclude,
  });
}

// Organizer (their trips only) or Admin (everything) — mirrors
// listAllBookings' scoping. Defaults to PENDING since that's the only
// thing a reviewer normally needs to act on; pass status: undefined to see
// the full history instead.
export function listChangeRequests(filters?: {
  status?: ChangeRequestStatus | null;
  organizerId?: string;
}) {
  return prisma.bookingChangeRequest.findMany({
    where: {
      ...(filters?.status ? { status: filters.status } : {}),
      ...(filters?.organizerId
        ? { booking: { trip: { organizerId: filters.organizerId } } }
        : {}),
    },
    include: changeRequestInclude,
    orderBy: { createdAt: "desc" },
  });
}

export interface ChangeRequestReviewInput {
  status: typeof ChangeRequestStatus.APPROVED | typeof ChangeRequestStatus.DECLINED;
  reviewedByUserId: string;
  reviewNote?: string;
}

export function reviewChangeRequest(id: string, data: ChangeRequestReviewInput) {
  return prisma.bookingChangeRequest.update({
    where: { id },
    data: {
      status: data.status,
      reviewedByUserId: data.reviewedByUserId,
      reviewedAt: new Date(),
      reviewNote: data.reviewNote,
    },
  });
}

export function listMyBookings(userId: string) {
  return prisma.booking.findMany({
    where: { userId },
    include: bookingInclude,
    orderBy: { createdAt: "desc" },
  });
}

// For an Organizer/Admin dashboard — all bookings for one trip (optionally
// scoped further by departure).
export function listBookingsForTrip(tripId: string, departureId?: string) {
  return prisma.booking.findMany({
    where: { tripId, ...(departureId ? { departureId } : {}) },
    include: bookingInclude,
    orderBy: { createdAt: "desc" },
  });
}

export function listAllBookings(filters?: { status?: BookingStatus; organizerId?: string }) {
  return prisma.booking.findMany({
    where: {
      ...(filters?.status ? { status: filters.status } : {}),
      ...(filters?.organizerId ? { trip: { organizerId: filters.organizerId } } : {}),
    },
    include: bookingInclude,
    orderBy: { createdAt: "desc" },
  });
}

export interface BookingUpdateInput {
  status?: BookingStatus;
  paymentMethod?: PaymentMethod;
  amountPaid?: number;
  // The only manual override left for payment status. A refund isn't a
  // function of amountPaid alone (money already left the account), so it
  // can't be derived the same way UNPAID/PARTIAL/PAID can.
  markRefunded?: boolean;
  notes?: string;
}

// Single source of truth for payment status. amountPaid is the only value
// staff (or a gateway webhook) ever write — this keeps status from ever
// drifting out of sync with the money, since it's recomputed from the
// numbers every time instead of being a second field someone can forget.
export function derivePaymentStatus(amountPaid: number, totalPrice: number): PaymentStatus {
  if (amountPaid <= 0) return PaymentStatus.UNPAID;
  if (amountPaid >= totalPrice) return PaymentStatus.PAID;
  return PaymentStatus.PARTIAL;
}

// totalPrice and currentStatus are threaded in by the caller (already has
// both from getBookingById) rather than re-queried here — totalPrice never
// changes after booking creation, and currentStatus is needed below to
// decide whether an auto-confirm applies.
export function updateBooking(
  id: string,
  data: BookingUpdateInput,
  totalPrice: number,
  currentStatus?: BookingStatus,
) {
  const { markRefunded, amountPaid, ...rest } = data;
  const updateData: Prisma.BookingUpdateInput = { ...rest };

  if (amountPaid !== undefined) {
    updateData.amountPaid = amountPaid;
    const derived = derivePaymentStatus(amountPaid, totalPrice);
    updateData.paymentStatus = markRefunded ? PaymentStatus.REFUNDED : derived;

    // Auto-confirm: a booking that reaches full payment (online or
    // manually recorded) while still sitting at PENDING moves itself to
    // CONFIRMED, so a fully-paid booking never silently stalls forever
    // behind a manual click nobody remembers to make. This only fires
    // when nobody explicitly set `status` in this same call (an explicit
    // human decision always wins) and only lifts PENDING -> CONFIRMED —
    // it never touches a booking that's already further along
    // (COMPLETED) or already CANCELLED, and never fires alongside a
    // refund (a booking being refunded isn't being freshly confirmed).
    if (
      !markRefunded &&
      derived === PaymentStatus.PAID &&
      data.status === undefined &&
      currentStatus === BookingStatus.PENDING
    ) {
      updateData.status = BookingStatus.CONFIRMED;
    }
  } else if (markRefunded) {
    updateData.paymentStatus = PaymentStatus.REFUNDED;
  }

  return prisma.booking.update({ where: { id }, data: updateData, include: bookingInclude });
}

// A user is considered to have "completed" a trip (and is therefore allowed
// to leave a verified review) if they have at least one COMPLETED booking
// for that trip.
export function hasCompletedBookingForTrip(userId: string, tripId: string) {
  return prisma.booking.findFirst({
    where: { userId, tripId, status: BookingStatus.COMPLETED },
  });
}