import { prisma } from "../config/prisma.js";

export interface TestimonialInput {
  name: string;
  country: string;
  tripName: string;
  quote: string;
}

export function listTestimonials() {
  return prisma.testimonial.findMany({ orderBy: { createdAt: "desc" } });
}

export function createTestimonial(data: TestimonialInput) {
  return prisma.testimonial.create({ data });
}

export function deleteTestimonial(id: string) {
  return prisma.testimonial.delete({ where: { id } });
}
