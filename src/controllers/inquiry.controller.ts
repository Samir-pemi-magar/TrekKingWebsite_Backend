import { NextFunction, Request, Response } from "express";
import { Region } from "@prisma/client";
import { z } from "zod";
import { ApiError } from "../utils/apiError.js";
import * as InquiryModel from "../models/inquiry.model.js";
import { getTripById } from "../models/trip.model.js";
import { sendMail, templates } from "../config/mailer.js";
import { env } from "../config/env.js";

const inquiryBodySchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  regionInterest: z.nativeEnum(Region).optional(),
  message: z.string().min(1).max(2000),
  tripId: z.string().uuid().optional(),
});

// Public — the contact form. Paired with rate limiting (see app.ts).
export async function submitInquiry(req: Request, res: Response, next: NextFunction) {
  try {
    const data = inquiryBodySchema.parse(req.body);

    if (data.tripId) {
      const trip = await getTripById(data.tripId);
      if (!trip) throw ApiError.badRequest("Referenced trip does not exist");
    }

    const inquiry = await InquiryModel.createInquiry({
      name: data.name,
      email: data.email,
      regionInterest: data.regionInterest,
      message: data.message,
      ...(data.tripId ? { trip: { connect: { id: data.tripId } } } : {}),
    });

    // Best-effort — never blocks the response if SMTP is unavailable/unset.
    void sendMail(data.email, "We've received your inquiry", templates.inquiryReceived(data.name));
    if (env.ADMIN_NOTIFICATION_EMAIL) {
      void sendMail(
        env.ADMIN_NOTIFICATION_EMAIL,
        "New inquiry received",
        templates.newInquiryAdmin(data.name, data.email, data.message)
      );
    }

    res.status(201).json({ status: "success", data: inquiry });
  } catch (err) {
    next(err);
  }
}

// Admin-only
export async function getInquiries(_req: Request, res: Response, next: NextFunction) {
  try {
    const inquiries = await InquiryModel.listInquiries();
    res.json({ status: "success", data: inquiries });
  } catch (err) {
    next(err);
  }
}

export async function deleteInquiry(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id;
    if (typeof id !== "string") throw ApiError.badRequest("Invalid inquiry id");

    const existing = await InquiryModel.getInquiryById(id);
    if (!existing) throw ApiError.notFound("Inquiry not found");

    await InquiryModel.deleteInquiry(id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
