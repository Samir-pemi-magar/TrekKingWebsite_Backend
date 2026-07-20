import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";

const reviewInclude = {
  user: { select: { id: true, name: true, avatarUrl: true, nationality: true } },
} satisfies Prisma.ReviewInclude;

export function listReviewsForTrip(tripId: string) {
  return prisma.review.findMany({
    where: { tripId },
    include: reviewInclude,
    orderBy: { createdAt: "desc" },
  });
}

export function getReviewById(id: string) {
  return prisma.review.findUnique({ where: { id } });
}

export function findExistingReview(userId: string, tripId: string) {
  return prisma.review.findUnique({ where: { tripId_userId: { tripId, userId } } });
}

export interface ReviewCreateInput {
  tripId: string;
  userId: string;
  rating: number;
  comment: string;
  isVerified: boolean;
}

export function createReview(data: ReviewCreateInput) {
  return prisma.review.create({ data, include: reviewInclude });
}

export function deleteReview(id: string) {
  return prisma.review.delete({ where: { id } });
}
