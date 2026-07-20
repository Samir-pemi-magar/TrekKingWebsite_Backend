import { NextFunction, Request, Response } from "express";
import { Role } from "@prisma/client";
import { z } from "zod";
import { ApiError } from "../utils/apiError.js";
import { requireStringParam } from "../utils/params.js";
import * as ReviewModel from "../models/review.model.js";
import * as BookingModel from "../models/booking.model.js";
import { getTripById } from "../models/trip.model.js";

const reviewBodySchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().min(1).max(1000),
});

// Public — shown on a trip's detail page.
export async function getTripReviews(req: Request, res: Response, next: NextFunction) {
  try {
    const tripId = requireStringParam(req.params.tripId);
    const reviews = await ReviewModel.listReviewsForTrip(tripId);
    res.json({ status: "success", data: reviews });
  } catch (err) {
    next(err);
  }
}

// Auth required. One review per user per trip. Automatically marked
// "verified" if the reviewer has a COMPLETED booking for that trip —
// this is what distinguishes it from the old free-text Testimonial model.
export async function createReview(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw ApiError.unauthorized();
    const tripId = requireStringParam(req.params.tripId);

    const trip = await getTripById(tripId);
    if (!trip) throw ApiError.notFound("Trip not found");

    const existing = await ReviewModel.findExistingReview(req.user.userId, tripId);
    if (existing) throw ApiError.conflict("You've already reviewed this trip");

    const data = reviewBodySchema.parse(req.body);
    const completedBooking = await BookingModel.hasCompletedBookingForTrip(req.user.userId, tripId);

    const review = await ReviewModel.createReview({
      tripId,
      userId: req.user.userId,
      rating: data.rating,
      comment: data.comment,
      isVerified: Boolean(completedBooking),
    });

    res.status(201).json({ status: "success", data: review });
  } catch (err) {
    next(err);
  }
}

// Author or Admin only.
export async function deleteReview(req: Request, res: Response, next: NextFunction) {
  try {
    const id = requireStringParam(req.params.id);
    const review = await ReviewModel.getReviewById(id);
    if (!review) throw ApiError.notFound("Review not found");

    const isAuthor = review.userId === req.user?.userId;
    if (!isAuthor && req.user?.role !== Role.ADMIN) {
      throw ApiError.forbidden("You can only delete your own review");
    }

    await ReviewModel.deleteReview(id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
