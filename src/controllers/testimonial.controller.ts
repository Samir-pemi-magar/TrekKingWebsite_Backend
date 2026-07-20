import { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { ApiError } from "../utils/apiError.js";
import * as TestimonialModel from "../models/testimonial.model.js";

const testimonialBodySchema = z.object({
  name: z.string().min(1),
  country: z.string().min(1),
  tripName: z.string().min(1),
  quote: z.string().min(1).max(1000),
});

export async function getTestimonials(_req: Request, res: Response, next: NextFunction) {
  try {
    const testimonials = await TestimonialModel.listTestimonials();
    res.json({ status: "success", data: testimonials });
  } catch (err) {
    next(err);
  }
}

// Admin-only
export async function createTestimonial(req: Request, res: Response, next: NextFunction) {
  try {
    const data = testimonialBodySchema.parse(req.body);
    const testimonial = await TestimonialModel.createTestimonial(data);
    res.status(201).json({ status: "success", data: testimonial });
  } catch (err) {
    next(err);
  }
}

export async function deleteTestimonial(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id;
    if (typeof id !== "string") throw ApiError.badRequest("Invalid testimonial id");

    await TestimonialModel.deleteTestimonial(id);
    res.status(204).send();
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "P2025") {
      return next(ApiError.notFound("Testimonial not found"));
    }
    next(err);
  }
}
